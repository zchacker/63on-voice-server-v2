const laravel = require('../../services/laravel.service');
const livekit = require('../../services/livekit.service');
const moderationState = require('../moderation/moderation.state');
const roomState = require('./room.state');
const validation = require('./room-policy.validation');
const state = require('./room-policy.state');

// Build identity from the authenticated connection, never client-supplied profile fields.
function connectionIdentity(socket, roomId) {
    if (!socket.authenticatedUserId || socket.authenticatedUserId !== socket.user?.userId) {
        throw new laravel.LaravelServiceError('AUTHENTICATION_REQUIRED', 'A trusted connection identity is required.', 403);
    }

    const identity = { user_id: socket.authenticatedUserId };
    if (moderationState.getCommandActorRole(roomId, socket.authenticatedUserId) === 'temporary_moderator') {
        identity.role = 'temporary_moderator';
    }

    return identity;
}

// Laravel is consulted on admission, not for ordinary messages or microphone requests.
async function readPolicy(roomId, identity) {
    const result = await laravel.readRoomPolicy(roomId, identity);
    const checked = validation.validatePolicy(result, roomId);
    if (!checked.valid) throw new laravel.LaravelServiceError(checked.code, checked.message, 502);
    if (checked.data.snapshot.user?.id !== identity.user_id) {
        throw new laravel.LaravelServiceError('INVALID_LARAVEL_IDENTITY', 'Policy identity does not match the connection.', 502);
    }

    return checked.data;
}

// Prefer newer pushed facts when a Laravel join response races with a policy update.
function validateAdmission(roomId, snapshot) {
    const cachedRoom = state.getRoom(roomId);
    const revision = state.getRoomRevision(roomId);
    if (revision && BigInt(revision.version) > BigInt(snapshot.version)) {
        if (revision.suspended) return 'ROOM_SUSPENDED';
        if (!cachedRoom || BigInt(cachedRoom.version) < BigInt(revision.version)) return 'POLICY_STALE';
    }

    const cachedUser = state.getUser(roomId, snapshot.user.id);
    const room = cachedRoom && BigInt(cachedRoom.version) > BigInt(snapshot.version)
        ? cachedRoom : {
            settings: snapshot.settings,
            messagesLocked: snapshot.messages_locked,
            suspended: snapshot.suspended
        };
    const facts = cachedUser && BigInt(cachedUser.version) > BigInt(snapshot.version) ? cachedUser.facts : snapshot.user;
    const temporary = moderationState.getCommandActorRole(roomId, facts.id) === 'temporary_moderator';
    const permissions = validation.resolvePermissions(room.settings, facts, room.messagesLocked, temporary, room.suspended);

    if (permissions.entry_error) return permissions.entry_error;
    if (room.settings.members_only && !facts.is_member && permissions.role === 'normal') return 'MEMBERS_ONLY';
    return null;
}

function currentPolicy(roomId, userId) {
    const room = state.getRoom(roomId);
    const user = state.getUser(roomId, userId);
    if (!room || !user) return null;

    const temporary = moderationState.getCommandActorRole(roomId, userId) === 'temporary_moderator';
    return {
        settings: room.settings,
        permissions: validation.resolvePermissions(room.settings, user.facts, room.messagesLocked, temporary, room.suspended)
    };
}

// Register one admitted connection and apply its cached policy without awaiting LiveKit.
function syncJoinedParticipant(io, socket) {
    const snapshot = socket.roomPolicy.snapshot;
    state.observeRoomRevision(snapshot);
    const changes = state.applySnapshot(snapshot);
    state.addConnection(socket.roomId, socket.authenticatedUserId, socket.id);
    socket.roomPolicy = null;
    if (state.getRoom(socket.roomId).messagesLocked) moderationState.lockMessages(socket.roomId);
    else moderationState.unlockMessages(socket.roomId);

    if (changes.room) refreshRoomParticipants(io, socket.roomId);
    else refreshUser(io, socket.roomId, socket.authenticatedUserId);
}

// Apply independent room/user versions so out-of-order events cannot restore old privileges.
function applyUpdate(io, roomId, snapshot) {
    const checked = validation.validateSnapshot(snapshot, roomId);
    if (!checked.valid) throw new laravel.LaravelServiceError(checked.code, checked.message, 422);

    const revision = state.observeRoomRevision(snapshot);
    const room = state.getRoom(roomId);
    if (!room) {
        if (revision.accepted && revision.changed && snapshot.suspended) {
            cancelPendingRoomJoins(io, roomId, snapshot.livekit_room_name);
            queueRoomRemoval(snapshot);
        }
        if (revision.accepted && snapshot.user && !snapshot.suspended
            && state.getMediaJob(roomId, snapshot.user.id)) {
            queueMedia(snapshot, snapshot.user, validation.resolvePermissions(
                snapshot.settings, snapshot.user, snapshot.messages_locked, false, snapshot.suspended
            ));
        }
        return;
    }

    if (!revision.accepted && !snapshot.user) return;
    const changes = state.applySnapshot(snapshot);
    if (changes.room) refreshRoomParticipants(io, roomId);
    else if (changes.user) refreshUser(io, roomId, snapshot.user.id);

    if (revision.accepted && revision.changed && snapshot.suspended) {
        cancelPendingRoomJoins(io, roomId, snapshot.livekit_room_name);
        queueRoomRemoval(snapshot);
    }

    if (snapshot.user && !state.getUser(roomId, snapshot.user.id)?.socketIds.size) {
        if (!snapshot.suspended && state.getMediaJob(roomId, snapshot.user.id)) {
            queueMedia(snapshot, snapshot.user, validation.resolvePermissions(
                snapshot.settings, snapshot.user, snapshot.messages_locked, false, snapshot.suspended
            ));
        }
        state.removeConnection(roomId, snapshot.user.id, null);
    }
}

// Recompute locally only when a setting changes; no HTTP call is made for participants.
function refreshRoomParticipants(io, roomId) {
    const room = state.getRoom(roomId);
    if (!room) return;

    if (room.messagesLocked) moderationState.lockMessages(roomId);
    else moderationState.unlockMessages(roomId);

    for (const userId of [...room.users.keys()]) refreshUser(io, roomId, userId);
}

// Update one user's connections and schedule only that user's temporary mute expiry.
function refreshUser(io, roomId, userId) {
    const room = state.getRoom(roomId);
    const user = state.getUser(roomId, userId);
    const data = currentPolicy(roomId, userId);
    if (!user || !data) return;

    moderationState.setPersistentRole(roomId, userId, user.facts.role);
    if (data.permissions.can_publish) moderationState.unmuteUser(roomId, userId);
    else moderationState.muteUser(roomId, userId);

    if (!data.permissions.can_publish && roomState.clearUserMic(roomId, userId)) {
        io.to(roomId).emit('micUpdate', { ...(roomState.getMicSpots(roomId) || {}) });
    }

    let mediaChanged = false;
    for (const socketId of [...user.socketIds]) {
        const socket = io.sockets.sockets.get(socketId);
        if (!socket || socket.roomId !== roomId || socket.authenticatedUserId !== userId) continue;

        const previous = socket.roomPolicy?.permissions;
        if (data.permissions.entry_error) {
            const reason = data.permissions.entry_error;
            socket.emit('kicked', { roomId, userId, reason });
            require('./room.service').leaveRoom(io, socket, reason === 'USER_BANNED' ? 'ban' : 'left');
            socket.disconnect(true);
            mediaChanged ||= reason === 'USER_BANNED';
            continue;
        }

        socket.roomPolicy = data;
        socket.emit('roomPolicyUpdated', { roomId, ...data });
        if (previous && previous.can_publish !== data.permissions.can_publish) {
            socket.emit(data.permissions.can_publish ? 'micUnmuted' : 'micMuted', { roomId, userId });
        }
        if (previous && previous.role !== data.permissions.role) {
            require('../moderation/moderation.service').handleJoin(socket, roomId);
        }

        mediaChanged ||= !previous || previous.can_publish !== data.permissions.can_publish
            || previous.direct_data_allowed !== data.permissions.direct_data_allowed;
    }

    if (mediaChanged && !room.suspended)
        queueMedia({ room_id: roomId, livekit_room_name: room.liveKitRoomName }, user.facts, data.permissions);
    scheduleMuteExpiry(io, roomId, userId, user);
}

function scheduleMuteExpiry(io, roomId, userId, user) {
    const dates = ['mic', 'messages'].flatMap((kind) => {
        const until = user.facts[kind + '_muted_until'];
        return user.facts[kind + '_muted'] && until && Date.parse(until) > Date.now() ? [until] : [];
    });
    const next = dates.sort((a, b) => Date.parse(a) - Date.parse(b))[0];

    if (user.socketIds.size) state.setExpiry(roomId, userId, next, () => refreshUser(io, roomId, userId));
}

// Revoke a departed temporary moderator's media privileges using the already cached facts.
async function syncDetachedParticipant(io, roomId, userId, roomName) {
    const data = currentPolicy(roomId, userId);
    const user = state.getUser(roomId, userId);
    if (data && user) queueMedia({ room_id: roomId, livekit_room_name: roomName }, user.facts, data.permissions);
}

function releaseConnection(roomId, userId, socketId) {
    state.removeConnection(roomId, userId, socketId);
}

// Queue only changed media permissions, with bounded concurrency independent of room commands.
function queueMedia(snapshot, facts, permissions) {
    state.enqueueMedia({
        roomId: snapshot.room_id,
        version: snapshot.version || state.getRoom(snapshot.room_id)?.version || '0',
        userId: facts.id,
        roomName: snapshot.livekit_room_name,
        remove: permissions.entry_error === 'USER_BANNED',
        bannedUntil: facts.banned_until,
        permissions
    });
    drainMedia();
}

function queueRoomRemoval(snapshot) {
    state.enqueueMedia({
        roomId: snapshot.room_id,
        version: snapshot.version,
        roomName: snapshot.livekit_room_name,
        removeAll: true
    });
    drainMedia();
}

function cancelPendingRoomJoins(io, roomId, liveKitRoomName) {
    for (const socket of io.sockets.sockets.values()) {
        if (!socket.pendingRoomId
            || (socket.pendingCanonicalRoomId !== roomId
                && String(socket.pendingRoomId) !== roomId
                && String(socket.pendingRoomId) !== liveKitRoomName)) continue;

        socket.roomJoinAttempt = (socket.roomJoinAttempt || 0) + 1;
        socket.pendingRoomId = null;
        socket.pendingCanonicalRoomId = null;
        socket.emit('joinRoomRejected', {
            roomId,
            userId: socket.authenticatedUserId || null,
            code: 'ROOM_SUSPENDED',
            message: 'This room is administratively suspended.'
        });
    }
}

function drainMedia() {
    let job;
    while ((job = state.takeMediaJob())) runMedia(job);
}

async function runMedia(job) {
    const task = job.task;
    let succeeded = false;
    try {
        if (task.removeAll) {
            await livekit.removeAllParticipants(task.roomName);
        } else if (task.remove) {
            if (!task.bannedUntil || Date.parse(task.bannedUntil) > Date.now()) {
                await livekit.removeActiveParticipant(task.roomName, task.userId);
            }
        } else {
            await livekit.updateParticipantPermissions(task.roomName, task.userId, task.permissions);
        }
        succeeded = true;
    } catch (error) {
        console.error('LiveKit policy update will be retried.', { roomId: task.roomId, code: error.code || 'LIVEKIT_UPDATE_FAILED' });
    } finally {
        state.finishMediaJob(job, task, succeeded, drainMedia);
        drainMedia();
    }
}

// Existing moderation callers can request removal without holding their room queue on LiveKit.
async function removeBannedParticipant(roomName, userId, roomId) {
    state.enqueueMedia({ roomId, userId, roomName, remove: true, bannedUntil: null });
    drainMedia();
}

module.exports = {
    connectionIdentity, readPolicy, validateAdmission, currentPolicy,
    syncJoinedParticipant, applyUpdate, refreshRoomParticipants, refreshUser,
    syncDetachedParticipant, releaseConnection, removeBannedParticipant,
    getRoomSuspension: state.getRoomSuspension
};

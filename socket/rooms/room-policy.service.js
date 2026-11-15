const laravel = require('../../services/laravel.service');
const livekit = require('../../services/livekit.service');
const moderationState = require('../moderation/moderation.state');
const roomState = require('./room.state');
const validation = require('./room-policy.validation');
const state = require('./room-policy.state');

function connectionIdentity(socket, roomId) {
    if (!socket.authenticatedUserId || socket.authenticatedUserId !== socket.user?.userId)
        throw new laravel.LaravelServiceError('AUTHENTICATION_REQUIRED', 'A trusted connection identity is required.', 403);
    const identity = { user_id: socket.authenticatedUserId };
    if (moderationState.getCommandActorRole(roomId, socket.authenticatedUserId) === 'temporary_moderator')
        identity.role = 'temporary_moderator';
    return identity;
}

async function readPolicy(roomId, identity) {
    const result = await laravel.readRoomPolicy(roomId, identity);
    const checked = validation.validatePolicy(result, roomId);
    if (!checked.valid) throw new laravel.LaravelServiceError(checked.code, checked.message, 502);
    return checked.data;
}

async function syncJoinedParticipant(io, socket) {
    const roomId = socket.roomId;
    const data = socket.roomPolicy;
    scheduleExpiry(io, roomId, data.next_change_at, true);
    socket.emit('roomPolicyUpdated', { roomId, settings: data.settings, permissions: data.permissions });
    await livekit.updateParticipantPermissions(socket.liveKitRoomName, socket.authenticatedUserId, data.permissions);
}

function scheduleExpiry(io, roomId, timestamp, keepEarlier = false) {
    state.setExpiryTimer(roomId, timestamp, () => {
        refreshRoom(io, roomId).catch((error) => console.error('Room policy expiry refresh failed.', { roomId, code: error.code }));
    }, keepEarlier);
}

async function removeBannedParticipant(roomName, identity, roomId) {
    state.rememberRemoval(roomName, identity, roomId);
    await livekit.removeActiveParticipant(roomName, identity);
    state.clearRemoval(roomName, identity);
}

async function syncDetachedParticipant(io, roomId, userId, roomName) {
    return roomState.runRoomOperation(roomId, async () => {
        const identity = { user_id: userId };
        if (moderationState.getCommandActorRole(roomId, userId) === 'temporary_moderator')
            identity.role = 'temporary_moderator';
        const data = await readPolicy(roomId, identity);
        if (data.permissions.entry_error === 'USER_BANNED')
            return removeBannedParticipant(roomName, userId, roomId);
        await livekit.updateParticipantPermissions(roomName, userId, data.permissions);
    });
}

async function refreshRoom(io, roomId) {
    return roomState.runRoomOperation(roomId, () => refreshRoomParticipants(io, roomId));
}

// The caller holds the shared room queue when joining or applying a moderation command.
async function refreshRoomParticipants(io, roomId) {
    const sockets = [...io.sockets.sockets.values()].filter((socket) => socket.roomId === roomId);
    const failures = [];
    let nextChange = null;
    for (const socket of sockets) {
        const user = socket.user;
        try {
            const data = await readPolicy(roomId, connectionIdentity(socket, roomId));
            if (socket.roomId !== roomId || socket.user !== user) continue;
            if (data.next_change_at && (!nextChange || Date.parse(data.next_change_at) < Date.parse(nextChange)))
                nextChange = data.next_change_at;
            const permissions = data.permissions;
            if (permissions.entry_error === 'USER_BANNED') {
                let removalError;
                try { await removeBannedParticipant(socket.liveKitRoomName, socket.authenticatedUserId, roomId); }
                catch (error) { removalError = error; }
                socket.emit('kicked', { roomId, userId: socket.authenticatedUserId, reason: 'USER_BANNED' });
                require('./room.service').leaveRoom(io, socket, 'ban');
                socket.disconnect(true);
                if (removalError) throw removalError;
                continue;
            }
            moderationState.setPersistentRole(roomId, user.userId,
                permissions.role === 'temporary_moderator' ? 'normal' : permissions.role);
            if (permissions.can_publish) moderationState.unmuteUser(roomId, user.userId);
            else {
                moderationState.muteUser(roomId, user.userId);
                if (roomState.clearUserMic(roomId, user.userId))
                    io.to(roomId).emit('micUpdate', { ...(roomState.getMicSpots(roomId) || {}) });
            }
            const previous = socket.roomPolicy;
            socket.roomPolicy = data;
            if (JSON.stringify(previous?.settings) !== JSON.stringify(data.settings)
                || JSON.stringify(previous?.permissions) !== JSON.stringify(permissions)) {
                socket.emit('roomPolicyUpdated', { roomId, settings: data.settings, permissions });
            }
            if (previous && previous.permissions.can_publish !== permissions.can_publish)
                socket.emit(permissions.can_publish ? 'micUnmuted' : 'micMuted', { roomId, userId: user.userId });
            if (previous && previous.permissions.role !== permissions.role)
                require('../moderation/moderation.service').handleJoin(socket, roomId);
            // Entry restrictions gate new joins; membership changes do not kick existing visitors.
            await livekit.updateParticipantPermissions(socket.liveKitRoomName, socket.authenticatedUserId, permissions);
        } catch (error) {
            failures.push({ userId: user?.userId, code: error.code || 'ROOM_POLICY_SYNC_FAILED' });
        }
    }
    scheduleExpiry(io, roomId, nextChange);
    if (failures.length) {
        const error = new Error('Some room participants could not be synchronized.');
        error.code = 'ROOM_POLICY_SYNC_FAILED';
        error.failures = failures;
        throw error;
    }
}

function startPolicyRefresh(io) {
    let running = false;
    const timer = setInterval(async () => {
        if (running) return;
        running = true;
        try {
            for (const target of state.getPendingRemovals()) {
                try {
                    const data = await readPolicy(target.roomId, { user_id: target.identity });
                    if (data.permissions.entry_error === 'USER_BANNED')
                        await removeBannedParticipant(target.roomName, target.identity, target.roomId);
                    else state.clearRemoval(target.roomName, target.identity);
                }
                catch (error) { console.error('LiveKit ban removal retry failed.', { code: error.code || 'LIVEKIT_REMOVAL_FAILED' }); }
            }
            const rooms = new Set([...io.sockets.sockets.values()].map((socket) => socket.roomId).filter(Boolean));
            for (const roomId of rooms) {
                try { await refreshRoom(io, roomId); }
                catch (error) { console.error('Room policy synchronization failed.', { roomId, code: error.code }); }
            }
        } finally { running = false; }
    }, 60000);
    timer.unref?.();
    return () => { clearInterval(timer); state.clearExpiryTimers(); };
}
module.exports = { syncDetachedParticipant, syncJoinedParticipant, removeBannedParticipant, connectionIdentity, readPolicy, refreshRoom, refreshRoomParticipants, startPolicyRefresh };

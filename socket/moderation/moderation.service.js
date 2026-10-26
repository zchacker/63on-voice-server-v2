const crypto = require('crypto');
const state = require('./moderation.state');
const validation = require('./moderation.validation');
const roomState = require('../rooms/room.state');
const laravel = require('../../services/laravel.service');

const roomActionQueues = new Map();
const PERSISTED_ACTIONS = {
    banUser: 'ban',
    unbanUser: 'unban',
    promoteFixedModerator: 'promote_fixed',
    demoteFixedModerator: 'demote_fixed',
    muteMic: 'mute_mic',
    unmuteMic: 'unmute_mic',
    lockMessages: 'lock_messages',
    unlockMessages: 'unlock_messages'
};

function emitResult(socket, action, payload, result) {
    const output = {
        action,
        success: result.success,
        code: result.code || 'OK',
        message: result.message,
        roomId: payload?.roomId || socket.roomId || null,
        targetUserId: payload?.targetUserId || null,
        role: result.role
    };
    if (result.state) output.state = result.state;
    socket.emit('moderationResult', output);
}

function fail(socket, action, payload, result) {
    emitResult(socket, action, payload, {
        success: false,
        code: result.code,
        message: result.message
    });
}

function activeSockets(io, roomId, userId) {
    return Array.from(io.sockets.sockets.values())
        .filter((candidate) => candidate.roomId === roomId && candidate.user?.userId === userId);
}

function publishUsers(io, roomId) {
    io.to(roomId).emit('userList', roomState.getRoomUsers(roomId));
}

function publishMics(io, roomId) {
    io.to(roomId).emit('micUpdate', { ...(roomState.getMicSpots(roomId) || {}) });
}

function validateTarget(socket, action, payload) {
    return validation.validateModeration(socket, payload, action);
}

function validateAction(socket, action, payload) {
    const result = validateTarget(socket, action, payload);
    if (!result.valid) fail(socket, action, payload, result);
    return result;
}

function cancelPendingJoins(io, roomId, targetUserId) {
    for (const candidate of io.sockets.sockets.values()) {
        if (candidate.authenticatedUserId !== targetUserId
            || (candidate.pendingRoomId !== roomId && candidate.pendingCanonicalRoomId !== roomId)) continue;

        candidate.roomJoinAttempt = (candidate.roomJoinAttempt || 0) + 1;
        candidate.pendingRoomId = null;
        candidate.pendingCanonicalRoomId = null;
        candidate.emit('joinRoomRejected', {
            roomId,
            userId: targetUserId,
            code: 'USER_BANNED',
            message: 'You are banned from this room.'
        });
    }
}

function removeTargetFromRoom(io, roomId, targetUserId, notify, reason) {
    const sockets = activeSockets(io, roomId, targetUserId);
    for (const target of sockets) {
        target.emit(notify, { roomId, userId: targetUserId, reason: reason || null });
        target.leave(roomId);
        target.roomId = null;
        target.requestedRoomId = null;
        target.user = null;
        roomState.removeRoomUser(roomId, target.id);
    }

    state.removeTemporary(roomId, targetUserId);
    roomState.clearUserMic(roomId, targetUserId);
    publishUsers(io, roomId);
    publishMics(io, roomId);
    return sockets.length;
}

async function persistAction(socket, action, payload) {
    const commandAction = PERSISTED_ACTIONS[action];
    if (!commandAction) return { valid: true, state: null };

    const roomId = payload.roomId;
    const actorUserId = socket.user.userId;
    const command = {
        requestId: crypto.randomUUID(),
        action: commandAction,
        actorUserId,
        actorRole: state.getCommandActorRole(roomId, actorUserId)
    };
    if (payload.targetUserId) command.targetUserId = payload.targetUserId;
    if (typeof payload.reason === 'string') command.reason = payload.reason.slice(0, 1000);

    const roomIdentifier = roomId;
    let response;
    try {
        response = await laravel.saveModerationCommand(roomIdentifier, command);
    } catch (error) {
        const configurationError = error.code?.startsWith('SOCKET_CONFIGURATION');
        const uncertain = !configurationError
            && (['LARAVEL_TIMEOUT', 'LARAVEL_UNAVAILABLE', 'INVALID_LARAVEL_RESPONSE'].includes(error.code)
                || error.status >= 500);
        if (uncertain) state.rememberPendingCommand(roomId, { roomIdentifier, command });
        return { valid: false, uncertain, ...laravel.getPublicError(error) };
    }

    const result = validation.validatePersistedCommandResult(commandAction, response, command.requestId);
    if (!result.valid && response.success === true) {
        state.rememberPendingCommand(roomId, { roomIdentifier, command });
        result.uncertain = true;
    }
    return result;
}

function rejectPersistence(io, socket, action, payload, result) {
    if (result.uncertain) {
        // انقطاع الرد لا يعني تراجع معاملة Laravel. نفرغ العضوية حتى يُعاد التحقق من الحالة الفعلية.
        const users = new Set(Array.from(io.sockets.sockets.values())
            .filter((candidate) => candidate.roomId === payload.roomId)
            .map((candidate) => candidate.user.userId));
        for (const userId of users) {
            removeTargetFromRoom(io, payload.roomId, userId, 'kicked', 'Room state requires reauthorization.');
        }
    }
    return fail(socket, action, payload, result);
}

function applyPersistedState(roomId, targetUserId, persistedState, reason, actorUserId) {
    if (targetUserId && typeof persistedState.banned === 'boolean') {
        if (persistedState.banned) {
            state.ban(roomId, targetUserId, {
                reason: reason || null,
                bannedBy: actorUserId,
                bannedAt: new Date().toISOString()
            });
        } else {
            state.unban(roomId, targetUserId);
        }
    }
    if (targetUserId && typeof persistedState.role === 'string') {
        state.setPersistentRole(roomId, targetUserId, persistedState.role);
    }
    if (targetUserId && typeof persistedState.micMuted === 'boolean') {
        if (persistedState.micMuted) state.muteUser(roomId, targetUserId);
        else state.unmuteUser(roomId, targetUserId);
    }
    if (typeof persistedState.messagesLocked === 'boolean') {
        if (persistedState.messagesLocked) state.lockMessages(roomId);
        else state.unlockMessages(roomId);
    }
}

async function moderationAction(io, socket, action, payload = {}) {
    const checked = validateAction(socket, action, payload);
    if (!checked.valid) return;

    const { roomId, targetUserId } = payload;
    const moderatorId = socket.user.userId;
    const reason = typeof payload.reason === 'string' ? payload.reason.slice(0, 1000) : null;
    const persisted = PERSISTED_ACTIONS[action]
        ? await persistAction(socket, action, payload)
        : { valid: true, state: null };
    if (!persisted.valid) return rejectPersistence(io, socket, action, payload, persisted);
    if (persisted.state) {
        applyPersistedState(roomId, targetUserId, persisted.state, reason, moderatorId);
    }

    let role;
    switch (action) {
        case 'banUser':
            cancelPendingJoins(io, roomId, targetUserId);
            removeTargetFromRoom(io, roomId, targetUserId, 'kicked', reason);
            io.to(roomId).emit('userBanned', { roomId, userId: targetUserId });
            break;
        case 'unbanUser':
            io.to(roomId).emit('userUnbanned', { roomId, userId: targetUserId });
            break;
        case 'removeUser':
            removeTargetFromRoom(io, roomId, targetUserId, 'kicked', reason);
            io.to(roomId).emit('userRemoved', { roomId, userId: targetUserId });
            break;
        case 'promoteTemporaryModerator':
            if (!activeSockets(io, roomId, targetUserId).length) {
                return fail(socket, action, payload, {
                    code: 'TARGET_NOT_IN_ROOM',
                    message: 'The target must currently be in the room for temporary promotion.'
                });
            }
            if (!activeSockets(io, roomId, targetUserId)
                .every((target) => target.authenticatedUserId === targetUserId)) {
                return fail(socket, action, payload, {
                    code: 'TARGET_NOT_AUTHENTICATED',
                    message: 'The target must have a valid authenticated session.'
                });
            }
            if (!state.promoteTemporary(roomId, targetUserId)) {
                return fail(socket, action, payload, {
                    code: 'FIXED_MODERATOR',
                    message: 'A room owner or fixed moderator cannot be changed to temporary.'
                });
            }
            role = 'temporary';
            break;
        case 'promoteFixedModerator':
            role = 'fixed';
            break;
        case 'demoteFixedModerator':
            state.removeTemporary(roomId, targetUserId);
            role = 'normal';
            break;
        case 'muteMic':
            roomState.clearUserMic(roomId, targetUserId);
            for (const target of activeSockets(io, roomId, targetUserId)) {
                target.emit('micMuted', { roomId, userId: targetUserId });
            }
            publishMics(io, roomId);
            io.to(roomId).emit('micModerationUpdated', {
                roomId,
                userId: targetUserId,
                muted: true
            });
            break;
        case 'unmuteMic':
            for (const target of activeSockets(io, roomId, targetUserId)) {
                target.emit('micUnmuted', { roomId, userId: targetUserId });
            }
            io.to(roomId).emit('micModerationUpdated', {
                roomId,
                userId: targetUserId,
                muted: false
            });
            break;
        default:
            return fail(socket, action, payload, {
                code: 'UNKNOWN_ACTION',
                message: 'Unknown moderation action.'
            });
    }

    if (role) {
        for (const target of activeSockets(io, roomId, targetUserId)) {
            target.emit('roleUpdated', { roomId, userId: targetUserId, role });
        }
        io.to(roomId).emit('moderatorUpdated', { roomId, userId: targetUserId, role });
    }

    emitResult(socket, action, payload, {
        success: true,
        message: 'Action completed.',
        role,
        state: persisted.state || undefined
    });
}

async function lockMessages(io, socket, payload = {}, locked) {
    const action = locked ? 'lockMessages' : 'unlockMessages';
    const checked = validation.validateModerator(socket, payload.roomId);
    if (!checked.valid) return fail(socket, action, payload, checked);

    // نثبت هوية المنفذ قبل انتظار الشبكة؛ قد يغادر الاتصال بينما يحفظ Laravel الأمر.
    const actorUserId = socket.user.userId;
    const persisted = await persistAction(socket, action, payload);
    if (!persisted.valid) return rejectPersistence(io, socket, action, payload, persisted);
    if (persisted.state.messagesLocked !== locked) {
        return fail(socket, action, payload, {
            code: 'LARAVEL_STATE_MISMATCH',
            message: 'Laravel did not confirm the requested message lock state.'
        });
    }
    applyPersistedState(payload.roomId, null, persisted.state, null, actorUserId);

    const eventPayload = {
        roomId: payload.roomId,
        locked,
        changedBy: actorUserId,
        normalUsersOnly: locked
    };
    io.to(payload.roomId).emit('messageLockUpdated', eventPayload);
    emitResult(socket, action, payload, {
        success: true,
        message: 'Action completed.',
        state: persisted.state
    });
}

async function handleModeration(io, socket, action, payload) {
    const normalizedPayload = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? { ...payload }
        : {};
    // نقبل ID المرسل أو الاسم الذي استُخدم عند الانضمام، ونطبق الإشراف على الغرفة الموحدة فقط.
    const suppliedRoomId = String(normalizedPayload.roomId ?? '');
    if (socket.roomId && [socket.roomId, socket.requestedRoomId].includes(suppliedRoomId))
        normalizedPayload.roomId = socket.roomId;
    const execute = async () => {
        try {
            if (action === 'lockMessages')
                return await lockMessages(io, socket, normalizedPayload, true);
            if (action === 'unlockMessages')
                return await lockMessages(io, socket, normalizedPayload, false);
            return await moderationAction(io, socket, action, normalizedPayload);
        } catch {
            fail(socket, action, normalizedPayload, {
                code: 'MODERATION_ACTION_FAILED',
                message: 'The moderation action could not be completed.'
            });
        }
    };

    const roomId = normalizedPayload.roomId;
    if (typeof roomId === 'string' && roomId.trim())
        return roomState.runRoomOperation(roomId, execute);
    return execute();
}

async function reconcileRoom(roomId) {
    const pending = state.getPendingCommand(roomId);
    if (!pending) return false;

    // لا نفتح الغرفة بعد نتيجة مجهولة حتى نسترجع نتيجة UUID الأصلي من Laravel.
    const { command, roomIdentifier } = pending;
    let response;
    try {
        response = await laravel.saveModerationCommand(roomIdentifier, command);
    } catch (error) {
        // يعيد Laravel النتيجة المحفوظة قبل فحص الصلاحيات؛ الرفض القطعي هنا يعني أن UUID لم يُحفظ.
        if ([403, 404, 422].includes(error.status)) {
            state.clearPendingCommand(roomId);
            return true;
        }
        throw error;
    }
    if (response.success === false) {
        state.clearPendingCommand(roomId);
        return true;
    }
    const result = validation.validatePersistedCommandResult(command.action, response, command.requestId);
    if (!result.valid) {
        throw new laravel.LaravelServiceError(
            'ROOM_STATE_UNCERTAIN', 'Room moderation state could not be reconciled.', 503
        );
    }
    applyPersistedState(roomId, command.targetUserId, result.state, command.reason, command.actorUserId);
    state.clearPendingCommand(roomId);
    return true;
}

function syncFromAuthorization(roomId, userId, authorization) {
    state.unban(roomId, userId);
    state.setPersistentRole(roomId, userId, authorization.role);

    if (authorization.moderation.micMuted) state.muteUser(roomId, userId);
    else state.unmuteUser(roomId, userId);

    if (authorization.room.messagesLocked) state.lockMessages(roomId);
    else state.unlockMessages(roomId);
}

function handleJoin(socket, roomId) {
    const userId = socket.user.userId;
    const role = validation.getActorRole(socket, roomId);
    socket.emit('roleUpdated', { roomId, userId, role });
}

function handleLeave(io, socket, roomId, userId) {
    if (roomId && userId && !activeSockets(io, roomId, userId).length)
        state.removeTemporary(roomId, userId);
}

function isMuted(roomId, userId) {
    return state.isUserMuted(roomId, userId);
}

function canSendMessage(socket) {
    const role = validation.getActorRole(socket, socket.roomId);
    return !state.areMessagesLocked(socket.roomId) || role !== 'normal';
}

function isMessagesLocked(roomId) {
    return state.areMessagesLocked(roomId);
}

module.exports = {
    handleModeration,
    handleJoin,
    handleLeave,
    syncFromAuthorization,
    reconcileRoom,
    isMuted,
    canSendMessage,
    isMessagesLocked
};

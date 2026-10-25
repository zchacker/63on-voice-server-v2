const state = require('./moderation.state');
const validation = require('./moderation.validation');
const roomState = require('../rooms/room.state');

function emitResult(socket, action, payload, result) {
    socket.emit('moderationResult', {
        action,
        success: result.success,
        code: result.code || 'OK',
        message: result.message,
        roomId: payload?.roomId || socket.roomId || null,
        targetUserId: payload?.targetUserId || null,
        role: result.role
    });
}
function fail(socket, action, payload, result) {
    emitResult(socket, action, payload, {
        success: false, code: result.code, message: result.message
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
function removeTargetFromRoom(io, roomId, targetUserId, notify, reason) {
    const sockets = activeSockets(io, roomId, targetUserId);
    for (const target of sockets) {
        target.emit(notify, { roomId, userId: targetUserId, reason: reason || null });
        target.leave(roomId);
        target.roomId = null;
        target.user = null;
        roomState.removeRoomUser(roomId, target.id);
    }
    state.removeTemporary(roomId, targetUserId);
    roomState.clearUserMic(roomId, targetUserId);
    publishUsers(io, roomId);
    publishMics(io, roomId);
    return sockets.length;
}
function moderationAction(io, socket, action, payload = {}) {
    const checked = validateAction(socket, action, payload);
    if (!checked.valid) return;
    const { roomId, targetUserId } = payload;
    const moderatorId = socket.user.userId;
    const reason = typeof payload.reason === 'string' ? payload.reason.slice(0, 300) : null;
    let role;
    switch (action) {
        case 'banUser':
            state.ban(roomId, targetUserId, {
                reason,
                bannedBy: moderatorId,
                bannedAt: new Date().toISOString()
            });
            removeTargetFromRoom(io, roomId, targetUserId, 'kicked', reason);
            io.to(roomId).emit('userBanned', { roomId, userId: targetUserId });
            break;
        case 'unbanUser':
            if (!state.unban(roomId, targetUserId)) {
                return fail(socket, action, payload, {
                    code: 'USER_NOT_BANNED', message: 'The target user is not banned.'
                });
            }
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
                    message: 'A fixed moderator cannot be changed to temporary.'
                });
            }
            role = 'temporary';
            break;
        case 'promoteFixedModerator':
            state.promoteFixed(roomId, targetUserId);
            role = 'fixed';
            break;
        case 'muteMic':
            state.muteUser(roomId, targetUserId);
            roomState.clearUserMic(roomId, targetUserId);
            for (const target of activeSockets(io, roomId, targetUserId))
                target.emit('micMuted', { roomId, userId: targetUserId });
            publishMics(io, roomId);
            io.to(roomId).emit('micModerationUpdated', { roomId, userId: targetUserId, muted: true });
            break;
        case 'unmuteMic':
            state.unmuteUser(roomId, targetUserId);
            for (const target of activeSockets(io, roomId, targetUserId))
                target.emit('micUnmuted', { roomId, userId: targetUserId });
            io.to(roomId).emit('micModerationUpdated', { roomId, userId: targetUserId, muted: false });
            break;
        default:
            return fail(socket, action, payload, {
                code: 'UNKNOWN_ACTION', message: 'Unknown moderation action.'
            });
    }
    if (role) {
        for (const target of activeSockets(io, roomId, targetUserId))
            target.emit('roleUpdated', { roomId, userId: targetUserId, role });
        io.to(roomId).emit('moderatorUpdated', { roomId, userId: targetUserId, role });
    }
    emitResult(socket, action, payload, { success: true, message: 'Action completed.', role });
}
function lockMessages(io, socket, payload = {}, locked) {
    const action = locked ? 'lockMessages' : 'unlockMessages';
    const checked = validation.validateModerator(socket, payload.roomId);
    if (!checked.valid) return fail(socket, action, payload, checked);
    if (locked) state.lockMessages(payload.roomId);
    else state.unlockMessages(payload.roomId);
    const eventPayload = {
        roomId: payload.roomId,
        locked,
        changedBy: socket.user.userId,
        normalUsersOnly: locked
    };
    io.to(payload.roomId).emit('messageLockUpdated', eventPayload);
    emitResult(socket, action, payload, { success: true, message: 'Action completed.' });
}
function handleModeration(io, socket, action, payload) {
    if (!payload || typeof payload !== 'object') payload = {};
    if (action === 'lockMessages') return lockMessages(io, socket, payload, true);
    if (action === 'unlockMessages') return lockMessages(io, socket, payload, false);
    moderationAction(io, socket, action, payload);
}
function handleJoin(socket, roomId) {
    const userId = socket.user.userId;
    const role = validation.getActorRole(socket, roomId);
    socket.emit('roleUpdated', { roomId, userId, role });
}
function handleBannedJoin(socket, roomId, userId) {
    const ban = state.getBan(roomId, userId);
    if (!ban) return false;
    socket.emit('joinRoomRejected', {
        roomId, userId, code: 'USER_BANNED', message: 'You are banned from this room.'
    });
    return true;
}
function handleLeave(io, socket, roomId, userId) {
    if (roomId && userId && !activeSockets(io, roomId, userId).length)
        state.clearTemporaryModerator(roomId, userId);
}
function isMuted(roomId, userId) { return state.isUserMuted(roomId, userId); }
function canSendMessage(socket) {
    const role = validation.getActorRole(socket, socket.roomId);
    return !state.areMessagesLocked(socket.roomId) || role !== 'normal';
}
function isMessagesLocked(roomId) { return state.areMessagesLocked(roomId); }
module.exports = { handleModeration, handleJoin, handleBannedJoin, handleLeave, isMuted, canSendMessage, isMessagesLocked };

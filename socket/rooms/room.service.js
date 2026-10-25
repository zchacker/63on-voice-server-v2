const state = require('./room.state');
const validation = require('./room.validation');
const moderation = require('../moderation/moderation.service');

function emitError(socket, event, result) {
    socket.emit(event, { code: result.code, message: result.message });
}
function joinRoom(io, socket, payload) {
    const checked = validation.validateJoin(payload, socket.authenticatedUserId);
    if (!checked.valid) return emitError(socket, 'joinRoomRejected', checked);
    const user = { ...payload.user };
    if (socket.authenticatedUserId) user.userId = socket.authenticatedUserId;
    if (moderation.handleBannedJoin(socket, payload.roomId, user.userId)) return;
    delete user.role;
    delete user.isModerator;
    delete user.permissions;

    if (socket.roomId) leaveRoom(io, socket);
    const roomId = payload.roomId;
    user.socketId = socket.id;
    socket.join(roomId);
    socket.roomId = roomId;
    socket.user = user;
    state.addRoomUser(roomId, socket.id, user);

    io.to(roomId).emit('userList', state.getRoomUsers(roomId));
    io.to(roomId).emit('micUpdate', { ...(state.getMicSpots(roomId) || {}) });
    moderation.handleJoin(socket, roomId);
    socket.emit('messageLockUpdated', {
        roomId,
        locked: moderation.isMessagesLocked(roomId),
        normalUsersOnly: moderation.isMessagesLocked(roomId)
    });
    if (moderation.isMuted(roomId, user.userId))
        socket.emit('micMuted', { roomId, userId: user.userId });
}
function requestMic(io, socket, payload = {}) {
    if (!payload || typeof payload !== 'object') payload = {};
    const joined = validation.validateJoinedUser(socket);
    if (!joined.valid) return emitError(socket, 'micRequestRejected', joined);
    const checked = validation.validateMicSpot(payload.spotNumber);
    if (!checked.valid) return emitError(socket, 'micRequestRejected', checked);
    if (moderation.isMuted(socket.roomId, socket.user.userId)) {
        return emitError(socket, 'micRequestRejected', {
            code: 'MIC_MUTED', message: 'Your microphone is muted by a moderator.'
        });
    }
    const spots = state.getMicSpots(socket.roomId) || {};
    if (spots[payload.spotNumber]) {
        return emitError(socket, 'micRejected', {
            code: 'MIC_SPOT_TAKEN', message: 'تم أخذ المكان بالفعل'
        });
    }
    spots[payload.spotNumber] = socket.user;
    state.setMicSpots(socket.roomId, spots);
    socket.emit('takeMic', { spotNumber: payload.spotNumber });
    io.to(socket.roomId).emit('micUpdate', { ...spots });
}
function leaveMic(io, socket, payload = {}) {
    if (!payload || typeof payload !== 'object') payload = {};
    const joined = validation.validateJoinedUser(socket);
    if (!joined.valid) return emitError(socket, 'micLeaveRejected', joined);
    const checked = validation.validateMicSpot(payload.spotNumber);
    if (!checked.valid) return emitError(socket, 'micLeaveRejected', checked);
    const spots = state.getMicSpots(socket.roomId) || {};
    if (spots[payload.spotNumber]?.userId !== socket.user.userId) {
        return emitError(socket, 'micLeaveRejected', {
            code: 'MIC_SPOT_NOT_OWNED', message: 'You do not own this microphone spot.'
        });
    }
    delete spots[payload.spotNumber];
    socket.emit('leaveMic', { spotNumber: payload.spotNumber });
    io.to(socket.roomId).emit('micUpdate', { ...spots });
}
function audioData(io, socket, data) {
    const joined = validation.validateJoinedUser(socket);
    if (!joined.valid) return emitError(socket, 'audioDataRejected', joined);
    if (moderation.isMuted(socket.roomId, socket.user.userId)) {
        return emitError(socket, 'audioDataRejected', {
            code: 'MIC_MUTED', message: 'Your microphone is muted by a moderator.'
        });
    }
    socket.to(socket.roomId).emit('audioData', {
        userId: socket.user.userId, audio: data
    });
}
function leaveRoom(io, socket) {
    const roomId = socket.roomId;
    const userId = socket.user?.userId;
    if (!roomId) return;
    const micChanged = state.clearUserMic(roomId, userId);
    state.removeRoomUser(roomId, socket.id);
    socket.leave(roomId);
    socket.roomId = null;
    socket.user = null;
    moderation.handleLeave(io, socket, roomId, userId);
    io.to(roomId).emit('userList', state.getRoomUsers(roomId));
    if (micChanged) io.to(roomId).emit('micUpdate', { ...(state.getMicSpots(roomId) || {}) });
    state.clearRoomState(roomId);
}
module.exports = { joinRoom, requestMic, leaveMic, audioData, leaveRoom };

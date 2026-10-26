const state = require('./room.state');
const validation = require('./room.validation');
const moderation = require('../moderation/moderation.service');
const laravel = require('../../services/laravel.service');

function emitError(socket, event, result) {
    socket.emit(event, { code: result.code, message: result.message });
}

function rejectJoin(socket, result) {
    const roomId = socket.pendingRoomId || null;
    socket.pendingRoomId = null;
    socket.pendingCanonicalRoomId = null;
    socket.emit('joinRoomRejected', {
        roomId,
        userId: socket.authenticatedUserId || null,
        code: result.code,
        message: result.message
    });
}

function joinRoom(io, socket, payload) {
    const attempt = (socket.roomJoinAttempt || 0) + 1;
    socket.roomJoinAttempt = attempt;
    const checked = validation.validateJoin(payload, socket.authenticatedUserId);
    socket.pendingRoomId = checked.roomId || null;
    if (!checked.valid) {
        rejectJoin(socket, checked);
        return Promise.resolve();
    }

    // sub الموثق هو مصدر الهوية؛ حقول user القادمة من الهاتف لا تدخل قرار الانضمام.
    const version = state.getOperationVersion();
    return completeJoin(io, socket, checked.roomId, attempt, version).catch((error) => {
        if (!isCurrentJoin(socket, attempt)) return;
        const result = error instanceof laravel.LaravelServiceError
            ? laravel.getPublicError(error)
            : { code: 'ROOM_JOIN_FAILED', message: 'The room could not be joined. Please try again.' };
        rejectJoin(socket, result);
    });
}

function isCurrentJoin(socket, attempt) {
    return socket.roomJoinAttempt === attempt && socket.connected !== false;
}

async function authorizeJoin(socket, requestedRoomId) {
    const result = await laravel.authorizeRoomJoin(
        requestedRoomId, socket.authenticatedUserId, socket.id
    );
    const checked = validation.validateJoinAuthorization(result, socket.authenticatedUserId);
    if (!checked.valid) {
        const error = new laravel.LaravelServiceError(checked.code, checked.message, 403);
        throw error;
    }
    return result;
}

async function completeJoin(io, socket, requestedRoomId, attempt, version) {
    let authorization = await authorizeJoin(socket, requestedRoomId);
    if (!isCurrentJoin(socket, attempt)) return;

    // قد يقبل Laravel الاسم أو ID؛ جميع الاتصالات والحالات تستخدم ID الموحد المعاد منه.
    const roomId = String(authorization.room.id);
    socket.pendingCanonicalRoomId = roomId;
    return state.runRoomOperation(roomId, async () => {
        if (!isCurrentJoin(socket, attempt)) return;
        // إن تغيّرت الغرفة أثناء طلب HTTP، نعيد التحقق داخل التسلسل قبل اعتماد الحالة.
        const reconciled = await moderation.reconcileRoom(roomId);
        if (reconciled || state.getRoomVersion(roomId) > version)
            authorization = await authorizeJoin(socket, requestedRoomId);
        if (!isCurrentJoin(socket, attempt)) return;
        if (String(authorization.room.id) !== roomId) {
            rejectJoin(socket, { code: 'ROOM_CHANGED', message: 'Room identity changed. Join again.' });
            return;
        }

        const userId = socket.authenticatedUserId;
        const user = {
            userId,
            name: authorization.user.name,
            avatar: authorization.user.avatar ?? authorization.user.img ?? null,
            socketId: socket.id
        };
        if (socket.roomId && socket.roomId !== roomId) leaveCurrentRoom(io, socket);
        await socket.join(roomId);
        if (!isCurrentJoin(socket, attempt)) {
            // قد يبدأ طلب أحدث للغرفة نفسها؛ لا نسحب عضويته أثناء إلغاء الطلب القديم.
            if (socket.roomId !== roomId) socket.leave(roomId);
            return;
        }

        moderation.syncFromAuthorization(roomId, userId, authorization);
        socket.roomId = roomId;
        socket.requestedRoomId = requestedRoomId;
        socket.liveKitRoomName = authorization.room.liveKitRoomName;
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
        if (moderation.isMuted(roomId, userId)) socket.emit('micMuted', { roomId, userId });
        socket.pendingRoomId = null;
        socket.pendingCanonicalRoomId = null;
    });
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
        userId: socket.user.userId,
        audio: data
    });
}

function leaveCurrentRoom(io, socket) {
    const roomId = socket.roomId;
    const userId = socket.user?.userId;
    if (!roomId) return;

    const micChanged = state.clearUserMic(roomId, userId);
    state.removeRoomUser(roomId, socket.id);
    socket.leave(roomId);
    socket.roomId = null;
    socket.requestedRoomId = null;
    socket.liveKitRoomName = null;
    socket.user = null;
    moderation.handleLeave(io, socket, roomId, userId);
    io.to(roomId).emit('userList', state.getRoomUsers(roomId));
    if (micChanged) io.to(roomId).emit('micUpdate', { ...(state.getMicSpots(roomId) || {}) });
    state.clearRoomState(roomId);
}

function broadcastRoomUpdated(io, roomId, fields) {
    io.to(roomId).emit('roomUpdated', { roomId, ...fields });
}

function leaveRoom(io, socket) {
    socket.roomJoinAttempt = (socket.roomJoinAttempt || 0) + 1;
    socket.pendingRoomId = null;
    socket.pendingCanonicalRoomId = null;
    leaveCurrentRoom(io, socket);
}

module.exports = { joinRoom, requestMic, leaveMic, audioData, leaveRoom, broadcastRoomUpdated };

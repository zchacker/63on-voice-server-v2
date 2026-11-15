const validation = require('./chat.validation');
const laravel = require('../../services/laravel.service');
const policy = require('../rooms/room-policy.service');
const state = require('../rooms/room.state');

async function sendMessage(io, socket, message) {
    const checked = validation.validateSendMessage(socket, message);
    if (!checked.valid) return socket.emit('messageRejected', { code: checked.code, message: checked.message });
    const roomId = socket.roomId;
    const user = socket.user;
    return state.runRoomOperation(roomId, async () => {
        if (socket.roomId !== roomId || socket.user !== user || socket.connected === false) return;
        try {
            const result = await laravel.authorizeMessage(roomId, policy.connectionIdentity(socket, roomId), message);
            if (result.allowed !== true) {
                socket.emit('messageRejected', { code: result.code || 'MESSAGE_NOT_ALLOWED',
                    ...(Number.isSafeInteger(result.retry_after) && result.retry_after > 0 ? { retry_after: result.retry_after } : {}) });
                return;
            }
            if (socket.roomId !== roomId || socket.user !== user || socket.connected === false) return;
            io.to(roomId).emit('newMessage', { message, user });
        } catch (error) {
            socket.emit('messageRejected', laravel.getPublicError(error));
        }
    });
}
module.exports = { sendMessage };

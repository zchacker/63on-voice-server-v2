const validation = require('./chat.validation');
const policyState = require('../rooms/room-policy.state');

// Validate and reserve locally in one synchronous turn across the user's room connections.
function sendMessage(io, socket, message) {
    const result = validation.validateSendMessage(socket, message);
    if (!result.valid) {
        socket.emit('messageRejected', { code: result.code, message: result.message,
            ...(result.retry_after ? { retry_after: result.retry_after } : {}) });
        return;
    }

    policyState.reserveMessage(socket.roomId, socket.authenticatedUserId, result.interval);
    io.to(socket.roomId).emit('newMessage', { message, user: socket.user });
}

module.exports = { sendMessage };

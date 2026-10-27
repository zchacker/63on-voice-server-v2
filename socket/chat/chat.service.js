const validation = require('./chat.validation');

function sendMessage(io, socket, message) {
    const result = validation.validateSendMessage(socket, message);
    if (!result.valid) {
        socket.emit('messageRejected', { code: result.code, message: result.message });
        return;
    }
    io.to(socket.roomId).emit('newMessage', { message, user: socket.user });
}
module.exports = { sendMessage };

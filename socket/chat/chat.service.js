function sendMessage(io, socket, message) {
    const roomId = socket.roomId
    io.to(roomId).emit('newMessage', {
        message: message,
        user: socket.user
    })
}

module.exports = {
    sendMessage
};

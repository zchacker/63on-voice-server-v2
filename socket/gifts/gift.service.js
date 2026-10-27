function sendGift(io, socket, gift) {
    const roomId = socket.roomId;
    if (!roomId || !socket.user) {
        socket.emit('giftRejected', { code: 'NOT_IN_ROOM', message: 'Join a room before sending gifts.' });
        return;
    }
    io.to(roomId).emit('sendGift', { gift, user: socket.user });
}
module.exports = { sendGift };

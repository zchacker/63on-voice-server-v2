function sendGift(io, socket, gift) {
    const roomId = socket.roomId
    io.to(roomId).emit('sendGift', {
        gift: gift,
        user: socket.user
    })
}

module.exports = {
    sendGift
};

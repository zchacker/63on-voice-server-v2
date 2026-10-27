const giftService = require('./gift.service');

module.exports = (io, socket) => {
    socket.on('sendGift', (data) => {
        giftService.sendGift(io, socket, data);
    });
};

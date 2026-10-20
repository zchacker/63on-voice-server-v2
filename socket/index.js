const roomEvents = require('./rooms/room.events');
const chatEvents = require('./chat/chat.events');
const giftEvents = require('./gifts/gift.events');
const userEvents = require('./users/user.events');

module.exports = (io) => {
    io.on('connection', (socket) => {
        console.log('New connection');

        roomEvents(io, socket);
        chatEvents(io, socket);
        giftEvents(io, socket);
        userEvents(io, socket);
    });
};

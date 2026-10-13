const roomEvents = require('./rooms/room.events');
const chatEvents = require('./chat/chat.events');
const giftEvents = require('./gifts/gift.events');

module.exports = (io) => {

    io.on('connection', (socket) => {

        roomEvents(io, socket);
        //chatEvents(io, socket);
        //giftEvents(io, socket);

    });

};
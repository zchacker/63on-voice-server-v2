const { installSocketAuth } = require('./auth/socket.auth');
const roomEvents = require('./rooms/room.events');
const chatEvents = require('./chat/chat.events');
const giftEvents = require('./gifts/gift.events');
const userEvents = require('./users/user.events');
const moderationEvents = require('./moderation/moderation.events');

module.exports = (io) => {
    installSocketAuth(io);
    io.on('connection', (socket) => {
        console.log('New connection');
        roomEvents(io, socket);
        chatEvents(io, socket);
        giftEvents(io, socket);
        userEvents(io, socket);
        moderationEvents(io, socket);
    });
};

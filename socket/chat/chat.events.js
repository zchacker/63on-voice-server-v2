const chatService = require('./chat.service');

module.exports = (io, socket) => {
    socket.on('sendMessage', (data) => {
        chatService.sendMessage(io, socket, data);
    });
};

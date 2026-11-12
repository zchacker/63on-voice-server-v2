const service = require('./auth.service');

module.exports = (_io, socket) => {
    socket.on('refreshSocketSession', (payload) => service.refreshSocketSession(socket, payload));
};

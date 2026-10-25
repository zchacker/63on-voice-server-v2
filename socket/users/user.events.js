const userService = require('./user.service');

module.exports = (io, socket) => {
    socket.on('leaveRoom', () => userService.leaveRoom(io, socket));
    socket.on('disconnect', () => userService.disconnect(io, socket));
};

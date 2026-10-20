const userService = require('./user.service');

module.exports = (io, socket) => {
    socket.on('removeUser', (data) => {
        userService.removeUser(io, socket, data);
    });

    socket.on('disconnect', () => {
        userService.disconnect(io, socket);
    });
};

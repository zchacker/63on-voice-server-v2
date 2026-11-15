const roomService = require('../rooms/room.service');

function leaveRoom(io, socket) {
    roomService.leaveRoom(io, socket);
}
function disconnect(io, socket) {
    roomService.leaveRoom(io, socket, 'disconnect');
}
module.exports = { leaveRoom, disconnect };

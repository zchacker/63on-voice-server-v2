const roomService = require('../rooms/room.service');

function leaveRoom(io, socket) {
    roomService.leaveRoom(io, socket);
}
function disconnect(io, socket) {
    leaveRoom(io, socket);
}
module.exports = { leaveRoom, disconnect };

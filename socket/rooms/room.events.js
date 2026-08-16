
const roomService = require('./room.service');

module.exports = (io, socket) => {

    socket.on('joinRoom', async (data) => {
        await roomService.joinRoom(io, socket, data);
    });

    socket.on('leaveRoom', async (data) => {
        await roomService.leaveRoom(io, socket, data);
    });

    socket.on('takeMic', async (data) => {
        await roomService.takeMic(io, socket, data);
    });

    socket.on('leaveMic', async (data) => {
        await roomService.leaveMic(io, socket, data);
    });
    
};
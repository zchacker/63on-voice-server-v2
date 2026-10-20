const roomService = require('./room.service');

module.exports = (io, socket) => {
    socket.on('joinRoom', (data) => {
        roomService.joinRoom(io, socket, data);
    });

    socket.on('requestMic', (data) => {
        roomService.requestMic(io, socket, data);
    });

    socket.on('leaveMic', (data) => {
        roomService.leaveMic(io, socket, data);
    });

    socket.on('audioData', (data) => {
        roomService.audioData(io, socket, data);
    });
};

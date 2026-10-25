const service = require('./moderation.service');

module.exports = (io, socket) => {
    for (const action of [
        'banUser', 'unbanUser', 'removeUser', 'promoteTemporaryModerator',
        'promoteFixedModerator', 'muteMic', 'unmuteMic'
    ]) {
        socket.on(action, (payload) => service.handleModeration(io, socket, action, payload));
    }
    socket.on('lockMessages', (payload) => service.handleModeration(io, socket, 'lockMessages', payload));
    socket.on('unlockMessages', (payload) => service.handleModeration(io, socket, 'unlockMessages', payload));
};

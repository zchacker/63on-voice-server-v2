const service = require('./moderation.service');

module.exports = (io, socket) => {
    for (const action of [
        'banUser',
        'unbanUser',
        'removeUser',
        'promoteTemporaryModerator',
        'promoteFixedModerator',
        'demoteFixedModerator',
        'muteMic',
        'unmuteMic',
        'lockMessages',
        'unlockMessages'
    ]) {
        socket.on(action, (payload) => service.handleModeration(io, socket, action, payload));
    }
};

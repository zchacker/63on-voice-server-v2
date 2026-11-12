const validation = require('./auth.validation');
const state = require('./auth.state');

function refreshSocketSession(socket, payload) {
    const result = validation.validateSessionRefresh(socket, payload);
    if (!result.valid) {
        socket.emit('socketSessionRefreshRejected', { code: result.code, message: result.message });
        return;
    }

    state.setSession(socket, result.claims);
    socket.emit('socketSessionRefreshed', {
        userId: result.claims.sub,
        expiresAt: result.claims.exp,
        expiresIn: result.claims.exp - Math.floor(Date.now() / 1000)
    });
}

module.exports = { refreshSocketSession };

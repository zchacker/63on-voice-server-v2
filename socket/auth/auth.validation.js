const { verifyToken } = require('./socket.auth');

function validateSessionRefresh(socket, payload) {
    if (!socket.authenticatedUserId || !socket.authenticatedClaims
        || socket.connected === false
        || Date.now() >= socket.authenticatedClaims.exp * 1000) {
        return { valid: false, code: 'AUTHENTICATION_REQUIRED', message: 'An active authenticated Socket session is required.' };
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || typeof payload.token !== 'string' || !payload.token) {
        return { valid: false, code: 'INVALID_REFRESH_PAYLOAD', message: 'A token string is required.' };
    }

    let claims;
    try {
        claims = verifyToken(payload.token, process.env.SOCKET_JWT_SECRET);
    } catch {
        return { valid: false, code: 'INVALID_SOCKET_TOKEN', message: 'The new Socket token is invalid or expired.' };
    }
    if (claims.sub !== socket.authenticatedUserId) {
        return { valid: false, code: 'SESSION_IDENTITY_MISMATCH', message: 'The new token must belong to the current user.' };
    }
    if (claims.exp <= socket.authenticatedClaims.exp) {
        return { valid: false, code: 'SESSION_NOT_EXTENDED', message: 'The new token must expire later than the current session.' };
    }
    return { valid: true, claims };
}

module.exports = { validateSessionRefresh };

function clearExpiryTimer(socket) {
    clearTimeout(socket.authExpiryTimer);
    socket.authExpiryTimer = null;
}

function setSession(socket, claims) {
    clearExpiryTimer(socket);
    socket.authenticatedUserId = claims.sub;
    socket.authenticatedClaims = claims;
    socket.authExpiryTimer = setTimeout(
        () => socket.disconnect(true),
        Math.max(1, claims.exp * 1000 - Date.now())
    );
    socket.authExpiryTimer.unref?.();
}

module.exports = { setSession, clearExpiryTimer };

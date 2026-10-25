const crypto = require('crypto');

function decodeBase64Url(value) {
    return Buffer.from(value, 'base64url').toString('utf8');
}

function verifyToken(token, secret) {
    if (!secret) throw new Error('SOCKET_JWT_SECRET is not configured.');
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid JWT format.');
    const [encodedHeader, encodedPayload, signature] = parts;
    const header = JSON.parse(decodeBase64Url(encodedHeader));
    const claims = JSON.parse(decodeBase64Url(encodedPayload));
    if (header.alg !== 'HS256') throw new Error('Only HS256 JWTs are accepted.');
    const expected = crypto.createHmac('sha256', secret)
        .update(encodedHeader + '.' + encodedPayload).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected))
        throw new Error('Invalid JWT signature.');
    const now = Math.floor(Date.now() / 1000);
    if (claims.exp && now >= claims.exp) throw new Error('JWT has expired.');
    if (claims.nbf && now < claims.nbf) throw new Error('JWT is not active yet.');
    if (typeof claims.sub !== 'string' || !claims.sub.trim())
        throw new Error('JWT subject (sub) is required.');
    return claims;
}

function installSocketAuth(io) {
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (!token) return next();
        try {
            const claims = verifyToken(token, process.env.SOCKET_JWT_SECRET);
            socket.authenticatedUserId = claims.sub;
            socket.authenticatedClaims = claims;
            next();
        } catch (error) {
            next(new Error('AUTHENTICATION_FAILED: ' + error.message));
        }
    });
}

module.exports = { installSocketAuth, verifyToken };

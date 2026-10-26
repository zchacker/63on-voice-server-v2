const crypto = require('crypto');

const DEFAULT_ISSUER = '63on-backend';
const DEFAULT_AUDIENCE = '63on-socket';
const MIN_SECRET_LENGTH = 32;

function decodeJsonSegment(value) {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    return JSON.parse(decoded);
}

function audienceMatches(claim, expectedAudience) {
    if (typeof claim === 'string') return claim === expectedAudience;
    return Array.isArray(claim) && claim.includes(expectedAudience);
}

function verifyToken(token, secret) {
    if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
        throw new Error('SOCKET_JWT_SECRET must be configured with at least 32 characters.');
    }

    if (typeof token !== 'string') throw new Error('Invalid JWT format.');
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => !part))
        throw new Error('Invalid JWT format.');

    const [encodedHeader, encodedPayload, signature] = parts;
    const header = decodeJsonSegment(encodedHeader);
    const claims = decodeJsonSegment(encodedPayload);

    if (header.alg !== 'HS256' || header.typ !== 'JWT')
        throw new Error('Only HS256 JWTs with typ JWT are accepted.');

    const expectedSignature = crypto.createHmac('sha256', secret)
        .update(encodedHeader + '.' + encodedPayload)
        .digest();
    const suppliedSignature = Buffer.from(signature, 'base64url');
    if (suppliedSignature.length !== expectedSignature.length
        || !crypto.timingSafeEqual(suppliedSignature, expectedSignature)) {
        throw new Error('Invalid JWT signature.');
    }

    const now = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(claims.iat) || claims.iat > now + 60)
        throw new Error('JWT iat must be a valid Unix timestamp.');
    if (typeof claims.jti !== 'string' || !claims.jti.trim())
        throw new Error('JWT jti is required.');
    if (!Number.isInteger(claims.exp) || now >= claims.exp || claims.exp <= claims.iat)
        throw new Error('JWT exp must be a valid future Unix timestamp.');
    if (claims.exp - claims.iat > 600)
        throw new Error('JWT lifetime cannot exceed 10 minutes.');
    if (claims.nbf !== undefined
        && (!Number.isInteger(claims.nbf) || now < claims.nbf)) {
        throw new Error('JWT nbf must be a valid active Unix timestamp.');
    }

    const expectedIssuer = process.env.SOCKET_JWT_ISSUER || DEFAULT_ISSUER;
    const expectedAudience = process.env.SOCKET_JWT_AUDIENCE || DEFAULT_AUDIENCE;
    if (claims.iss !== expectedIssuer)
        throw new Error('JWT issuer does not match SOCKET_JWT_ISSUER.');
    if (!audienceMatches(claims.aud, expectedAudience))
        throw new Error('JWT audience does not match SOCKET_JWT_AUDIENCE.');
    if (typeof claims.sub !== 'string' || !claims.sub.trim())
        throw new Error('JWT subject (sub) is required.');

    return claims;
}

// Laravel يصدر socket_token بعد Sanctum؛ نتحقق هنا من JWT ونثبت sub دون قبول هوية من الهاتف.
function installSocketAuth(io) {
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (!token) return next();

        try {
            const claims = verifyToken(token, process.env.SOCKET_JWT_SECRET);
            socket.authenticatedUserId = claims.sub;
            socket.authenticatedClaims = claims;

            // يمنع مؤقت الانتهاء بقاء صلاحيات جلسة قديمة فعالة بعد انتهاء توكنها.
            const expiresInMs = Math.max(1, claims.exp * 1000 - Date.now());
            const expiryTimer = setTimeout(() => socket.disconnect(true), expiresInMs);
            expiryTimer.unref?.();
            socket.once('disconnect', () => clearTimeout(expiryTimer));
            socket.use((_packet, continuePacket) => {
                if (Date.now() < claims.exp * 1000) return continuePacket();
                socket.disconnect(true);
            });
            next();
        } catch (error) {
            next(new Error('AUTHENTICATION_FAILED: ' + error.message));
        }
    });
}

module.exports = { installSocketAuth, verifyToken };

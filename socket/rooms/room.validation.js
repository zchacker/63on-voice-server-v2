const MIN_MIC_SPOT = 0;
const MAX_MIC_SPOT = 7;
const JOINABLE_ROLES = new Set(['owner', 'fixed_moderator', 'normal']);

function validateRoomPayload(payload) {
    if (payload && Number.isSafeInteger(payload.roomId) && payload.roomId > 0)
        return { valid: true, roomId: String(payload.roomId) };
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || typeof payload.roomId !== 'string' || !payload.roomId.trim()) {
        return { valid: false, code: 'INVALID_ROOM_ID', message: 'roomId is required.' };
    }
    return { valid: true, roomId: payload.roomId.trim() };
}

function validateJoin(payload, authenticatedUserId) {
    const room = validateRoomPayload(payload);
    if (!room.valid) return room;
    if (typeof authenticatedUserId !== 'string' || !authenticatedUserId.trim()) {
        return {
            valid: false,
            code: 'AUTHENTICATION_REQUIRED',
            message: 'A valid Socket JWT is required to join a room.'
        };
    }
    return { valid: true, roomId: room.roomId };
}

function hasIdentifier(value) {
    return (typeof value === 'string' && Boolean(value.trim()))
        || (typeof value === 'number' && Number.isFinite(value));
}

function validateJoinAuthorization(result, authenticatedUserId) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
        return {
            valid: false,
            code: 'INVALID_LARAVEL_RESPONSE',
            message: 'Laravel returned an invalid room authorization response.'
        };
    }
    if (result.allowed === false) {
        return {
            valid: false,
            code: typeof result.code === 'string' ? result.code : 'JOIN_NOT_ALLOWED',
            message: typeof result.message === 'string'
                ? result.message
                : 'Laravel denied access to this room.'
        };
    }
    if (result.allowed !== true) {
        return {
            valid: false,
            code: 'INVALID_LARAVEL_RESPONSE',
            message: 'Laravel did not provide a room authorization decision.'
        };
    }

    const user = result.user;
    const room = result.room;
    const moderation = result.moderation;
    if (!user || typeof user !== 'object' || Array.isArray(user)
        || !hasIdentifier(user.id)
        || String(user.id) !== authenticatedUserId
        || typeof user.name !== 'string'
        || !user.name.trim()) {
        return {
            valid: false,
            code: 'INVALID_LARAVEL_IDENTITY',
            message: 'Laravel returned a user identity that does not match the Socket JWT.'
        };
    }
    if (!room || typeof room !== 'object' || Array.isArray(room)
        || !hasIdentifier(room.id)
        || !hasIdentifier(room.ownerId)
        || typeof room.messagesLocked !== 'boolean') {
        return {
            valid: false,
            code: 'INVALID_LARAVEL_ROOM_STATE',
            message: 'Laravel returned an invalid room state.'
        };
    }
    if (!JOINABLE_ROLES.has(result.role)) {
        return {
            valid: false,
            code: 'INVALID_LARAVEL_ROLE',
            message: 'Laravel returned an unsupported persistent room role.'
        };
    }
    if ((result.role === 'owner') !== (String(room.ownerId) === authenticatedUserId)) {
        return {
            valid: false,
            code: 'INVALID_LARAVEL_ROLE',
            message: 'Laravel room role does not match its owner identity.'
        };
    }
    if (!moderation || typeof moderation !== 'object' || Array.isArray(moderation)
        || typeof moderation.banned !== 'boolean'
        || typeof moderation.micMuted !== 'boolean') {
        return {
            valid: false,
            code: 'INVALID_LARAVEL_MODERATION_STATE',
            message: 'Laravel returned an invalid moderation state.'
        };
    }
    if (moderation.banned) {
        return {
            valid: false,
            code: 'USER_BANNED',
            message: 'The user is banned from this room.'
        };
    }

    return { valid: true };
}

function validateMicSpot(spotNumber) {
    if (!Number.isInteger(spotNumber) || spotNumber < MIN_MIC_SPOT || spotNumber > MAX_MIC_SPOT) {
        return {
            valid: false,
            code: 'INVALID_MIC_SPOT',
            message: 'spotNumber must be an integer from 0 to 7.'
        };
    }
    return { valid: true };
}

function validateJoinedUser(socket) {
    if (!socket.roomId || !socket.user?.userId) {
        return { valid: false, code: 'NOT_IN_ROOM', message: 'Join a room first.' };
    }
    return { valid: true };
}

module.exports = {
    validateRoomPayload,
    validateJoin,
    validateJoinAuthorization,
    validateMicSpot,
    validateJoinedUser
};

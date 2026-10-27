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
        || typeof room.liveKitRoomName !== 'string'
        || !room.liveKitRoomName.trim()
        || room.liveKitRoomName.length > 255
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

function validateRoomUpdateFields(fields) {
    const allowedFields = new Set(['title', 'image', 'country', 'description']);
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
        return { valid: false, code: 'INVALID_ROOM_UPDATE', message: 'Updated room fields are required.' };
    }
    const keys = Object.keys(fields);
    if (!keys.length || keys.some((key) => !allowedFields.has(key))) {
        return { valid: false, code: 'INVALID_ROOM_UPDATE', message: 'Only public room fields may be broadcast.' };
    }

    const normalized = {};
    if (Object.hasOwn(fields, 'title')) {
        if (typeof fields.title !== 'string' || !fields.title.trim() || fields.title.length > 100) {
            return { valid: false, code: 'INVALID_ROOM_UPDATE', message: 'title must be a non-empty string up to 100 characters.' };
        }
        normalized.title = fields.title;
    }
    if (Object.hasOwn(fields, 'image')) {
        if (fields.image !== null && (typeof fields.image !== 'string' || fields.image.length > 2048)) {
            return { valid: false, code: 'INVALID_ROOM_UPDATE', message: 'image must be a public URL/path or null.' };
        }
        normalized.image = fields.image;
    }
    if (Object.hasOwn(fields, 'description')) {
        if (fields.description !== null
            && (typeof fields.description !== 'string' || fields.description.length > 500)) {
            return { valid: false, code: 'INVALID_ROOM_UPDATE', message: 'description must be a string up to 500 characters or null.' };
        }
        normalized.description = fields.description;
    }
    if (Object.hasOwn(fields, 'country')) {
        const country = fields.country;
        if (country === null) {
            normalized.country = null;
            return { valid: true, fields: normalized };
        }
        const idIsValid = typeof country?.id === 'string' && Boolean(country.id.trim());
        if (!country || typeof country !== 'object' || Array.isArray(country)
            || Object.keys(country).some((key) => !['id', 'name', 'code', 'imageUrl'].includes(key))
            || !idIsValid
            || typeof country.name !== 'string'
            || typeof country.code !== 'string'
            || (country.imageUrl !== null && typeof country.imageUrl !== 'string')) {
            return {
                valid: false,
                code: 'INVALID_ROOM_UPDATE',
                message: 'country must contain only id, name, code, and nullable imageUrl.'
            };
        }
        normalized.country = {
            id: country.id,
            name: country.name,
            code: country.code,
            imageUrl: country.imageUrl
        };
    }

    return { valid: true, fields: normalized };
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
    validateRoomUpdateFields,
    validateMicSpot,
    validateJoinedUser
};

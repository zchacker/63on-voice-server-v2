const state = require('./moderation.state');

const MODERATOR_ROLES = new Set(['root', 'owner', 'fixed', 'temporary']);
const API_ROLES = new Set(['owner', 'fixed_moderator', 'normal']);

function rootModeratorIds() {
    return new Set((process.env.SOCKET_ROOT_MODERATOR_IDS || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean));
}

function getActorRole(socket, roomId) {
    const userId = socket.authenticatedUserId;
    if (!userId || userId !== socket.user?.userId) return 'normal';
    return state.getRole(roomId, userId, rootModeratorIds());
}

function validateModeration(socket, payload, action) {
    if (!payload || typeof payload.roomId !== 'string' || !payload.roomId.trim()) {
        return { valid: false, code: 'INVALID_ROOM_ID', message: 'roomId is required.' };
    }
    if (socket.roomId !== payload.roomId || !socket.user?.userId) {
        return {
            valid: false,
            code: 'NOT_IN_ROOM',
            message: 'Join this room before moderating it.'
        };
    }
    if (!socket.authenticatedUserId || socket.authenticatedUserId !== socket.user.userId) {
        return {
            valid: false,
            code: 'AUTHENTICATION_REQUIRED',
            message: 'A valid Socket JWT is required to moderate.'
        };
    }
    if (typeof payload.targetUserId !== 'string' || !payload.targetUserId.trim()) {
        return {
            valid: false,
            code: 'INVALID_TARGET_USER_ID',
            message: 'targetUserId is required.'
        };
    }

    const actorRole = getActorRole(socket, payload.roomId);
    if (!MODERATOR_ROLES.has(actorRole)) {
        return {
            valid: false,
            code: 'FORBIDDEN',
            message: 'Moderator privileges are required.'
        };
    }
    if (payload.targetUserId === socket.user.userId) {
        return { valid: false, code: 'SELF_TARGET', message: 'You cannot apply this action to yourself.' };
    }

    const targetRole = state.getRole(payload.roomId, payload.targetUserId, rootModeratorIds());
    if (targetRole === 'root' || targetRole === 'owner') {
        return {
            valid: false,
            code: 'PROTECTED_TARGET',
            message: 'Room owners and root moderators cannot be targeted.'
        };
    }
    if (targetRole === 'fixed' && action !== 'demoteFixedModerator') {
        return {
            valid: false,
            code: 'PROTECTED_TARGET',
            message: 'Demote a fixed moderator before applying another moderation action.'
        };
    }
    if (action === 'promoteFixedModerator' || action === 'demoteFixedModerator') {
        if (actorRole !== 'owner') {
            return {
                valid: false,
                code: 'FORBIDDEN',
                message: 'Only the room owner can change a fixed moderator role.'
            };
        }
    }
    if (action === 'promoteTemporaryModerator'
        && !['root', 'owner', 'fixed'].includes(actorRole)) {
        return {
            valid: false,
            code: 'FORBIDDEN',
            message: 'Only the owner or a fixed moderator can assign a temporary moderator.'
        };
    }

    return { valid: true, actorRole };
}

function validateModerator(socket, roomId) {
    if (!roomId || socket.roomId !== roomId || !socket.user?.userId) {
        return { valid: false, code: 'NOT_IN_ROOM', message: 'Join this room first.' };
    }
    if (!socket.authenticatedUserId || socket.authenticatedUserId !== socket.user.userId) {
        return {
            valid: false,
            code: 'AUTHENTICATION_REQUIRED',
            message: 'A valid Socket JWT is required to moderate.'
        };
    }

    const actorRole = getActorRole(socket, roomId);
    if (!MODERATOR_ROLES.has(actorRole)) {
        return { valid: false, code: 'FORBIDDEN', message: 'Moderator privileges are required.' };
    }
    return { valid: true, actorRole };
}

function validatePersistedCommandResult(action, response, requestId) {
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
        return {
            valid: false,
            code: 'INVALID_LARAVEL_RESPONSE',
            message: 'Laravel returned an invalid moderation response.'
        };
    }
    if (response.requestId !== requestId) {
        return {
            valid: false,
            code: 'INVALID_LARAVEL_RESPONSE',
            message: 'Laravel returned a different moderation requestId.'
        };
    }
    if (response.success !== true) {
        return {
            valid: false,
            code: typeof response.code === 'string' ? response.code : 'LARAVEL_COMMAND_REJECTED',
            message: typeof response.message === 'string'
                ? response.message
                : 'Laravel rejected the moderation command.'
        };
    }

    const resultState = response.state;
    if (!resultState || typeof resultState !== 'object' || Array.isArray(resultState)) {
        return {
            valid: false,
            code: 'INVALID_LARAVEL_RESPONSE',
            message: 'Laravel moderation response is missing its state.'
        };
    }

    const expected = {
        ban: ['banned', true],
        unban: ['banned', false],
        promote_fixed: ['role', 'fixed_moderator'],
        demote_fixed: ['role', 'normal'],
        mute_mic: ['micMuted', true],
        unmute_mic: ['micMuted', false],
        lock_messages: ['messagesLocked', true],
        unlock_messages: ['messagesLocked', false]
    }[action];

    if (!expected
        || resultState[expected[0]] !== expected[1]) {
        return {
            valid: false,
            code: 'LARAVEL_STATE_MISMATCH',
            message: 'Laravel did not return the state required by the moderation action.'
        };
    }
    if (resultState.role !== undefined && resultState.role !== null
        && !API_ROLES.has(resultState.role)) {
        return {
            valid: false,
            code: 'INVALID_LARAVEL_ROLE',
            message: 'Laravel returned an unsupported persistent room role.'
        };
    }

    return { valid: true, state: resultState };
}

module.exports = {
    validateModeration,
    validateModerator,
    validatePersistedCommandResult,
    getActorRole,
    rootModeratorIds
};

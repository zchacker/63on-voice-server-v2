const state = require('./moderation.state');

function rootModeratorIds() {
    return new Set((process.env.SOCKET_ROOT_MODERATOR_IDS || '').split(',').map((id) => id.trim()).filter(Boolean));
}
function getActorRole(socket, roomId) {
    const userId = socket.authenticatedUserId;
    if (!userId || userId !== socket.user?.userId) return 'normal';
    return state.getRole(roomId, userId, rootModeratorIds());
}
function validateModeration(socket, payload, action) {
    if (!payload || typeof payload.roomId !== 'string' || !payload.roomId.trim())
        return { valid: false, code: 'INVALID_ROOM_ID', message: 'roomId is required.' };
    if (socket.roomId !== payload.roomId || !socket.user?.userId)
        return { valid: false, code: 'NOT_IN_ROOM', message: 'Join this room before moderating it.' };
    if (typeof payload.targetUserId !== 'string' || !payload.targetUserId.trim())
        return { valid: false, code: 'INVALID_TARGET_USER_ID', message: 'targetUserId is required.' };
    const actorRole = getActorRole(socket, payload.roomId);
    if (!['root', 'fixed', 'temporary'].includes(actorRole))
        return { valid: false, code: 'FORBIDDEN', message: 'Moderator privileges are required.' };
    if (payload.targetUserId === socket.user.userId)
        return { valid: false, code: 'SELF_TARGET', message: 'You cannot apply this action to yourself.' };
    const targetRole = state.getRole(payload.roomId, payload.targetUserId, rootModeratorIds());
    if (targetRole === 'root' || (targetRole === 'fixed' && actorRole !== 'root'))
        return { valid: false, code: 'INSUFFICIENT_ROLE', message: 'You cannot moderate or change the role of this user.' };
    if (targetRole === 'fixed' && action.startsWith('promote'))
        return { valid: false, code: 'FIXED_MODERATOR', message: 'The target is already a fixed moderator.' };
    if (action === 'promoteFixedModerator' && actorRole !== 'root')
        return { valid: false, code: 'FORBIDDEN', message: 'Only a root moderator can assign a fixed moderator.' };
    if (action === 'promoteTemporaryModerator' && actorRole === 'temporary')
        return { valid: false, code: 'FORBIDDEN', message: 'Only a fixed or root moderator can assign a temporary moderator.' };
    return { valid: true, actorRole };
}
function validateModerator(socket, roomId) {
    if (!roomId || socket.roomId !== roomId || !socket.user?.userId)
        return { valid: false, code: 'NOT_IN_ROOM', message: 'Join this room first.' };
    const actorRole = getActorRole(socket, roomId);
    if (!['root', 'fixed', 'temporary'].includes(actorRole))
        return { valid: false, code: 'FORBIDDEN', message: 'Moderator privileges are required.' };
    return { valid: true, actorRole };
}
module.exports = { validateModeration, validateModerator, getActorRole, rootModeratorIds };

const MIN_MIC_SPOT = 0;
const MAX_MIC_SPOT = 7;

function validateRoomPayload(payload) {
    if (!payload || typeof payload.roomId !== 'string' || !payload.roomId.trim())
        return { valid: false, code: 'INVALID_ROOM_ID', message: 'roomId is required.' };
    return { valid: true };
}
function validateJoin(payload, authenticatedUserId) {
    const room = validateRoomPayload(payload);
    if (!room.valid) return room;
    if (!payload.user || typeof payload.user !== 'object' || Array.isArray(payload.user))
        return { valid: false, code: 'INVALID_USER', message: 'user must be an object.' };
    if (!authenticatedUserId && (typeof payload.user.userId !== 'string' || !payload.user.userId.trim()))
        return { valid: false, code: 'INVALID_USER_ID', message: 'user.userId is required without a JWT.' };
    return { valid: true };
}
function validateMicSpot(spotNumber) {
    if (!Number.isInteger(spotNumber) || spotNumber < MIN_MIC_SPOT || spotNumber > MAX_MIC_SPOT)
        return { valid: false, code: 'INVALID_MIC_SPOT', message: 'spotNumber must be an integer from 0 to 7.' };
    return { valid: true };
}
function validateJoinedUser(socket) {
    if (!socket.roomId || !socket.user?.userId)
        return { valid: false, code: 'NOT_IN_ROOM', message: 'Join a room first.' };
    return { valid: true };
}
module.exports = { validateRoomPayload, validateJoin, validateMicSpot, validateJoinedUser };

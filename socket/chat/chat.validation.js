const moderationService = require('../moderation/moderation.service');

function validateSendMessage(socket, message) {
    if (!socket.roomId || !socket.user?.userId)
        return { valid: false, code: 'NOT_IN_ROOM', message: 'Join a room before sending messages.' };
    if (!moderationService.canSendMessage(socket))
        return { valid: false, code: 'MESSAGES_LOCKED', message: 'Only moderators can send messages while chat is locked.' };
    if (message === undefined || message === null)
        return { valid: false, code: 'INVALID_MESSAGE', message: 'Message payload is required.' };
    return { valid: true };
}
module.exports = { validateSendMessage };

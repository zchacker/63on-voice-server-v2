function validateSendMessage(socket, message) {
    if (!socket.roomId || !socket.user?.userId)
        return { valid: false, code: 'NOT_IN_ROOM', message: 'Join a room before sending messages.' };
    if (socket.authenticatedUserId !== socket.user.userId)
        return { valid: false, code: 'AUTHENTICATION_REQUIRED', message: 'A trusted connection identity is required.' };
    if (typeof message !== 'string' || !message.trim())
        return { valid: false, code: 'INVALID_MESSAGE', message: 'Message payload is required.' };
    if ([...message].length > 10000)
        return { valid: false, code: 'MESSAGE_TOO_LONG', message: 'Messages cannot exceed 10000 characters.' };
    return { valid: true };
}
module.exports = { validateSendMessage };

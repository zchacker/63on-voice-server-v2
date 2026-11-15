const policy = require('../rooms/room-policy.service');
const state = require('../rooms/room-policy.state');
const LINK_PATTERN = /(?:https?:\/\/|www\.|[\p{L}\p{N}-]+\.(?:[\p{L}]{2,63}|xn--[a-z0-9-]+)(?:[\/?:#]|(?=$|[^\p{L}\p{N}_])))/iu;

// Enforce cached policy server-side even when a client ignores UI permission updates.
function validateSendMessage(socket, message) {
    if (!socket.roomId || !socket.user?.userId) {
        return { valid: false, code: 'NOT_IN_ROOM', message: 'Join a room before sending messages.' };
    }
    if (socket.authenticatedUserId !== socket.user.userId || socket.connected === false) {
        return { valid: false, code: 'AUTHENTICATION_REQUIRED', message: 'A trusted connection identity is required.' };
    }
    if (typeof message !== 'string' || !message.trim()) {
        return { valid: false, code: 'INVALID_MESSAGE', message: 'A non-empty message is required.' };
    }

    const data = policy.currentPolicy(socket.roomId, socket.authenticatedUserId);
    if (!data) return { valid: false, code: 'POLICY_UNAVAILABLE', message: 'Rejoin to load room permissions.' };
    const permissions = data.permissions;

    if (!permissions.can_message) {
        return { valid: false, code: permissions.entry_error || 'MESSAGES_DISABLED', message: 'Room policy does not allow messaging.' };
    }
    if ([...message].length > (permissions.message_max_length ?? 10000)) {
        return { valid: false, code: 'MESSAGE_TOO_LONG', message: 'The message exceeds the allowed length.' };
    }
    // shortcut: conventional links only; extend content moderation if obfuscation becomes an issue.
    if (!permissions.links_allowed && LINK_PATTERN.test(message)) {
        return { valid: false, code: 'LINKS_DISABLED', message: 'Visitor links are disabled.' };
    }

    const retry = permissions.message_interval_seconds ? state.retryAfter(socket.roomId, socket.authenticatedUserId) : 0;
    if (retry) return { valid: false, code: 'SLOW_MODE', message: 'Wait before sending another message.', retry_after: retry };

    return { valid: true, interval: permissions.message_interval_seconds };
}

module.exports = { validateSendMessage };

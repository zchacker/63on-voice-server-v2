const BOOLEAN_SETTINGS = [
    'members_only', 'allow_anonymous_guests', 'visitor_messages_allowed',
    'member_messages_allowed', 'visitor_mic_allowed', 'member_mic_allowed', 'visitor_links_allowed'
];
const BOOLEAN_FACTS = ['is_member', 'banned', 'mic_muted', 'messages_muted'];
const DEADLINES = ['banned_until', 'mic_muted_until', 'messages_muted_until'];

function validDate(value) {
    return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}

// Reject incomplete internal snapshots before they can affect cached authorization.
function validateSnapshot(snapshot, roomId) {
    const settings = snapshot?.settings;
    const user = snapshot?.user;
    const validNumber = (value, max) => value === null || (Number.isInteger(value) && value >= 1 && value <= max);

    if (!snapshot || String(snapshot.room_id) !== String(roomId)
        || typeof snapshot.version !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(snapshot.version)
        || typeof snapshot.livekit_room_name !== 'string' || !snapshot.livekit_room_name.trim()
        || typeof snapshot.messages_locked !== 'boolean'
        || !settings || !BOOLEAN_SETTINGS.every((key) => typeof settings[key] === 'boolean')
        || !validNumber(settings.message_max_length, 10000)
        || !validNumber(settings.message_interval_seconds, 3600)
        || !['welcome_message', 'rules'].every((key) => settings[key] === null || typeof settings[key] === 'string')
        || !Object.hasOwn(snapshot, 'user')
        || (user !== null && (!user || typeof user.id !== 'string' || !/^[1-9][0-9]*$/.test(user.id)
            || !['owner', 'fixed_moderator', 'normal'].includes(user.role)
            || !BOOLEAN_FACTS.every((key) => typeof user[key] === 'boolean')
            || !DEADLINES.every((key) => validDate(user[key]))))) {
        return { valid: false, code: 'INVALID_LARAVEL_POLICY', message: 'A complete versioned policy snapshot is required.' };
    }

    return { valid: true, snapshot };
}

function validatePolicy(result, roomId) {
    const checked = validateSnapshot(result?.data?.snapshot, roomId);
    if (!checked.valid) return checked;

    const permissions = result.data.permissions;
    if (!permissions || !Object.hasOwn(permissions, 'entry_error')
        || (permissions.entry_error !== null && typeof permissions.entry_error !== 'string')) {
        return { valid: false, code: 'INVALID_LARAVEL_POLICY', message: 'An entry decision is required.' };
    }

    return { valid: true, data: result.data };
}

function active(flag, until, now) {
    return flag && (until === null || Date.parse(until) > now);
}

// Existing visitors retain admission when members_only changes; bans still take effect.
function resolvePermissions(settings, facts, messagesLocked, temporary, now = Date.now()) {
    const role = facts.role === 'normal' && temporary ? 'temporary_moderator' : facts.role;
    const staff = role !== 'normal';
    const banned = active(facts.banned, facts.banned_until, now);
    const prefix = facts.is_member ? 'member' : 'visitor';
    const canMessage = !banned && (staff || (!messagesLocked
        && !active(facts.messages_muted, facts.messages_muted_until, now) && settings[prefix + '_messages_allowed']));
    const linksAllowed = staff || facts.is_member || settings.visitor_links_allowed;
    const interval = staff ? null : settings.message_interval_seconds;

    return {
        entry_error: banned ? 'USER_BANNED' : null,
        role,
        is_member: facts.is_member,
        can_publish: !banned && (staff || (settings[prefix + '_mic_allowed'] && !active(facts.mic_muted, facts.mic_muted_until, now))),
        can_message: canMessage,
        direct_data_allowed: canMessage && settings.message_max_length === null && interval === null && linksAllowed,
        links_allowed: linksAllowed,
        message_max_length: settings.message_max_length,
        message_interval_seconds: interval
    };
}

module.exports = { validateSnapshot, validatePolicy, resolvePermissions };

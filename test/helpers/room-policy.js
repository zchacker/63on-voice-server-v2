function snapshot(roomId, userId = '42', options = {}) {
    return {
        version: options.version || '0',
        room_id: roomId,
        livekit_room_name: 'livekit-' + roomId,
        messages_locked: options.locked || false,
        settings: {
            members_only: false, allow_anonymous_guests: true,
            visitor_messages_allowed: true, member_messages_allowed: true,
            visitor_mic_allowed: true, member_mic_allowed: true,
            visitor_links_allowed: true, message_max_length: null,
            message_interval_seconds: null, welcome_message: null, rules: null,
            ...options.settings
        },
        user: userId === null ? null : {
            id: userId, role: userId === '1' ? 'owner' : 'normal', is_member: false,
            banned: false, banned_until: null,
            mic_muted: false, mic_muted_until: null,
            messages_muted: false, messages_muted_until: null,
            ...options.user
        }
    };
}

function response(roomId, userId, options = {}) {
    const value = snapshot(roomId, userId, options);
    return { data: {
        snapshot: value, room_id: roomId, settings: value.settings,
        permissions: { entry_error: null, role: value.user?.role || 'normal',
            can_publish: !value.user?.mic_muted, can_message: true, direct_data_allowed: true }
    } };
}

module.exports = { snapshot, response };

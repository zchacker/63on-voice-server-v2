function validatePolicy(result, roomId) {
    const data = result?.data;
    const permissions = data?.permissions;
    if (String(data?.room_id) !== String(roomId) || !data?.settings
        || (data.next_change_at != null && (typeof data.next_change_at !== 'string' || !Number.isFinite(Date.parse(data.next_change_at))))
        || !permissions || !Object.hasOwn(permissions, 'entry_error')
        || (permissions.entry_error !== null && typeof permissions.entry_error !== 'string')
        || !['can_publish', 'can_message', 'direct_data_allowed'].every((key) => typeof permissions[key] === 'boolean')
        || !['owner', 'fixed_moderator', 'temporary_moderator', 'normal'].includes(permissions.role)) {
        return { valid: false, code: 'INVALID_LARAVEL_POLICY', message: 'Laravel returned an invalid room policy.' };
    }
    return { valid: true, data };
}
module.exports = { validatePolicy };

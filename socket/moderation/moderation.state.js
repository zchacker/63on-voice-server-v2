// نحفظ UUID للأوامر مجهولة النتيجة حتى نسترجعها من Laravel قبل السماح بالدخول مجددًا.
const pendingCommands = new Map();
const bannedUsers = new Map();

function rememberPendingCommand(roomId, pending) { pendingCommands.set(roomId, pending); }
function getPendingCommand(roomId) { return pendingCommands.get(roomId); }
function clearPendingCommand(roomId) { pendingCommands.delete(roomId); }
const temporaryModerators = new Map();
const fixedModerators = new Map();
const roomOwners = new Map();
const mutedUsers = new Map();
const lockedRooms = new Set();

function roomSet(map, roomId) {
    if (!map.has(roomId)) map.set(roomId, new Set());
    return map.get(roomId);
}

function roomMap(map, roomId) {
    if (!map.has(roomId)) map.set(roomId, new Map());
    return map.get(roomId);
}

function ban(roomId, userId, details) {
    roomMap(bannedUsers, roomId).set(userId, details);
}

function unban(roomId, userId) {
    const users = bannedUsers.get(roomId);
    if (!users) return false;

    const removed = users.delete(userId);
    if (!users.size) bannedUsers.delete(roomId);
    return removed;
}

function getBan(roomId, userId) {
    return bannedUsers.get(roomId)?.get(userId);
}

function setPersistentRole(roomId, userId, role) {
    const normalizedRole = role === 'fixed' ? 'fixed_moderator' : role;
    const owners = roomOwners.get(roomId);
    const fixed = fixedModerators.get(roomId);

    owners?.delete(userId);
    fixed?.delete(userId);

    if (normalizedRole === 'owner') roomSet(roomOwners, roomId).add(userId);
    if (normalizedRole === 'fixed_moderator') {
        roomSet(fixedModerators, roomId).add(userId);
        removeTemporary(roomId, userId);
    }
    if (normalizedRole === 'owner') removeTemporary(roomId, userId);

    if (owners?.size === 0) roomOwners.delete(roomId);
    if (fixed?.size === 0) fixedModerators.delete(roomId);
}

function getPersistentRole(roomId, userId) {
    if (roomOwners.get(roomId)?.has(userId)) return 'owner';
    if (fixedModerators.get(roomId)?.has(userId)) return 'fixed_moderator';
    return 'normal';
}

function promoteTemporary(roomId, userId) {
    if (getPersistentRole(roomId, userId) !== 'normal') return false;
    roomSet(temporaryModerators, roomId).add(userId);
    return true;
}

function promoteFixed(roomId, userId) {
    setPersistentRole(roomId, userId, 'fixed_moderator');
}

function removeTemporary(roomId, userId) {
    const users = temporaryModerators.get(roomId);
    if (!users) return;

    users.delete(userId);
    if (!users.size) temporaryModerators.delete(roomId);
}

function removeFixed(roomId, userId) {
    const users = fixedModerators.get(roomId);
    if (!users) return false;

    const removed = users.delete(userId);
    if (!users.size) fixedModerators.delete(roomId);
    return removed;
}

function getRole(roomId, userId, rootModeratorIds = new Set()) {
    if (roomOwners.get(roomId)?.has(userId)) return 'owner';
    if (rootModeratorIds.has(userId)) return 'root';
    if (fixedModerators.get(roomId)?.has(userId)) return 'fixed';
    if (temporaryModerators.get(roomId)?.has(userId)) return 'temporary';
    return 'normal';
}

function getCommandActorRole(roomId, userId) {
    const persistentRole = getPersistentRole(roomId, userId);
    if (persistentRole === 'owner') return 'owner';
    if (persistentRole === 'fixed_moderator') return 'fixed_moderator';
    if (temporaryModerators.get(roomId)?.has(userId)) return 'temporary_moderator';
    return 'normal';
}

function muteUser(roomId, userId) {
    roomSet(mutedUsers, roomId).add(userId);
}

function unmuteUser(roomId, userId) {
    const users = mutedUsers.get(roomId);
    if (!users) return false;

    const removed = users.delete(userId);
    if (!users.size) mutedUsers.delete(roomId);
    return removed;
}

function isUserMuted(roomId, userId) {
    return mutedUsers.get(roomId)?.has(userId) || false;
}

function lockMessages(roomId) {
    lockedRooms.add(roomId);
}

function unlockMessages(roomId) {
    lockedRooms.delete(roomId);
}

function areMessagesLocked(roomId) {
    return lockedRooms.has(roomId);
}

function clearRoom(roomId) {
    bannedUsers.delete(roomId);
    temporaryModerators.delete(roomId);
    fixedModerators.delete(roomId);
    roomOwners.delete(roomId);
    mutedUsers.delete(roomId);
    lockedRooms.delete(roomId);
}

module.exports = {
    rememberPendingCommand,
    getPendingCommand,
    clearPendingCommand,
    ban,
    unban,
    getBan,
    setPersistentRole,
    getPersistentRole,
    promoteTemporary,
    promoteFixed,
    removeTemporary,
    removeFixed,
    getRole,
    getCommandActorRole,
    muteUser,
    unmuteUser,
    isUserMuted,
    lockMessages,
    unlockMessages,
    areMessagesLocked,
    clearRoom
};

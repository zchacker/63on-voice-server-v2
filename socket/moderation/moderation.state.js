// In-memory adapter. Replace these maps with a Laravel-backed repository when persistence is enabled.
const bannedUsers = new Map();
const temporaryModerators = new Map();
const fixedModerators = new Map();
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
function ban(roomId, userId, details) { roomMap(bannedUsers, roomId).set(userId, details); }
function unban(roomId, userId) {
    const users = bannedUsers.get(roomId);
    if (!users) return false;
    const removed = users.delete(userId);
    if (!users.size) bannedUsers.delete(roomId);
    return removed;
}
function getBan(roomId, userId) { return bannedUsers.get(roomId)?.get(userId); }
function promoteTemporary(roomId, userId) {
    if (fixedModerators.get(roomId)?.has(userId)) return false;
    roomSet(temporaryModerators, roomId).add(userId);
    return true;
}
function promoteFixed(roomId, userId) {
    roomSet(fixedModerators, roomId).add(userId);
    temporaryModerators.get(roomId)?.delete(userId);
}
function removeTemporary(roomId, userId) {
    const users = temporaryModerators.get(roomId);
    if (!users) return;
    users.delete(userId);
    if (!users.size) temporaryModerators.delete(roomId);
}
function getRole(roomId, userId, rootModeratorIds = new Set()) {
    if (rootModeratorIds.has(userId)) return 'root';
    if (fixedModerators.get(roomId)?.has(userId)) return 'fixed';
    if (temporaryModerators.get(roomId)?.has(userId)) return 'temporary';
    return 'normal';
}
function muteUser(roomId, userId) { roomSet(mutedUsers, roomId).add(userId); }
function unmuteUser(roomId, userId) {
    const users = mutedUsers.get(roomId);
    if (!users) return false;
    const removed = users.delete(userId);
    if (!users.size) mutedUsers.delete(roomId);
    return removed;
}
function isUserMuted(roomId, userId) { return mutedUsers.get(roomId)?.has(userId) || false; }
function lockMessages(roomId) { lockedRooms.add(roomId); }
function unlockMessages(roomId) { lockedRooms.delete(roomId); }
function areMessagesLocked(roomId) { return lockedRooms.has(roomId); }
function clearRoom(roomId) {
    bannedUsers.delete(roomId);
    temporaryModerators.delete(roomId);
    fixedModerators.delete(roomId);
    mutedUsers.delete(roomId);
    lockedRooms.delete(roomId);
}
module.exports = { ban, unban, getBan, promoteTemporary, promoteFixed, removeTemporary, getRole, muteUser, unmuteUser, isUserMuted, lockMessages, unlockMessages, areMessagesLocked, clearRoom };

// shortcut: removal retries are in memory; persist them when restart recovery is required.
const pendingRemovals = new Map();
function rememberRemoval(roomName, identity, roomId) { pendingRemovals.set(JSON.stringify([roomName, identity]), { roomName, identity, roomId }); }
function clearRemoval(roomName, identity) { pendingRemovals.delete(JSON.stringify([roomName, identity])); }
function getPendingRemovals() { return [...pendingRemovals.values()]; }
const expiryTimers = new Map();
function setExpiryTimer(roomId, timestamp, callback, keepEarlier = false) {
    const existing = expiryTimers.get(roomId);
    if (keepEarlier && existing && (!timestamp || existing.timestamp <= Date.parse(timestamp))) return;
    clearTimeout(existing?.timer);
    expiryTimers.delete(roomId);
    if (!timestamp) return;
    const delay = Math.max(1, Date.parse(timestamp) - Date.now() + 50);
    const timer = setTimeout(() => { expiryTimers.delete(roomId); callback(); }, Math.min(delay, 2147483647));
    timer.unref?.();
    expiryTimers.set(roomId, { timer, timestamp: Date.parse(timestamp) });
}
function clearExpiryTimers() {
    for (const entry of expiryTimers.values()) clearTimeout(entry.timer);
    expiryTimers.clear();
}
module.exports = { rememberRemoval, clearRemoval, getPendingRemovals, setExpiryTimer, clearExpiryTimers };

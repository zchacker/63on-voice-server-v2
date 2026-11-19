const rooms = new Map();
const expiryTimers = new Map();
const cooldowns = new Map();
const mediaJobs = new Map();
const readyMedia = new Set();
const roomRevisions = new Map();
const roomAliases = new Map();
let activeMediaJobs = 0;

// Keep room suspension versions after the last Socket leaves so delayed callbacks stay harmless.
function observeRoomRevision(snapshot) {
    const roomId = snapshot.room_id;
    const current = roomRevisions.get(roomId);
    const room = rooms.get(roomId);
    const currentVersion = current?.version || room?.version;

    if (currentVersion && BigInt(snapshot.version) <= BigInt(currentVersion)) {
        return { accepted: false, changed: false, current };
    }

    const previousSuspended = current?.suspended ?? room?.suspended ?? false;
    roomRevisions.set(roomId, {
        version: snapshot.version,
        suspended: snapshot.suspended,
        liveKitRoomName: snapshot.livekit_room_name
    });

    if (current?.liveKitRoomName && roomAliases.get(current.liveKitRoomName) === roomId) {
        roomAliases.delete(current.liveKitRoomName);
    }
    roomAliases.set(snapshot.livekit_room_name, roomId);

    return {
        accepted: true,
        changed: previousSuspended !== snapshot.suspended,
        suspended: snapshot.suspended
    };
}

function getRoomRevision(roomId) { return roomRevisions.get(roomId); }

function getRoomSuspension(roomIdentifier) {
    const roomId = roomRevisions.has(roomIdentifier)
        ? roomIdentifier
        : roomAliases.get(roomIdentifier);
    return roomId ? roomRevisions.get(roomId) : undefined;
}

// Keep one room snapshot and independently versioned facts for each admitted user.
function applySnapshot(snapshot) {
    let room = rooms.get(snapshot.room_id);
    if (!room) {
        room = { version: '-1', users: new Map() };
        rooms.set(snapshot.room_id, room);
    }

    const changes = { room: false, user: false };
    if (BigInt(snapshot.version) > BigInt(room.version)) {
        changes.room = !room.settings || JSON.stringify(room.settings) !== JSON.stringify(snapshot.settings)
            || room.messagesLocked !== snapshot.messages_locked
            || room.suspended !== snapshot.suspended;
        Object.assign(room, {
            version: snapshot.version,
            settings: snapshot.settings,
            messagesLocked: snapshot.messages_locked,
            suspended: snapshot.suspended,
            liveKitRoomName: snapshot.livekit_room_name
        });
    }

    if (snapshot.user) {
        const previous = room.users.get(snapshot.user.id);
        if (!previous || BigInt(snapshot.version) > BigInt(previous.version)) {
            room.users.set(snapshot.user.id, {
                version: snapshot.version,
                facts: snapshot.user,
                socketIds: previous?.socketIds || new Set()
            });
            changes.user = true;
        }
    }

    return changes;
}

function getRoom(roomId) { return rooms.get(roomId); }
function getUser(roomId, userId) { return rooms.get(roomId)?.users.get(userId); }

function addConnection(roomId, userId, socketId) {
    getUser(roomId, userId).socketIds.add(socketId);
}

// Release inactive membership data; a future admission loads a fresh Laravel snapshot.
function removeConnection(roomId, userId, socketId) {
    const room = getRoom(roomId);
    const user = getUser(roomId, userId);
    if (!user) return;

    user.socketIds.delete(socketId);
    if (!user.socketIds.size) {
        room.users.delete(userId);
        clearExpiry(roomId, userId);
    }

    if (!room.users.size) rooms.delete(roomId);
}

function timerKey(roomId, userId) { return JSON.stringify([roomId, userId]); }

// Schedule only the affected user's mute expiry, replacing any superseded deadline.
function setExpiry(roomId, userId, timestamp, callback) {
    clearExpiry(roomId, userId);
    if (!timestamp) return;

    const key = timerKey(roomId, userId);
    const timer = setTimeout(() => {
        expiryTimers.delete(key);
        callback();
    }, Math.min(2147483647, Math.max(1, Date.parse(timestamp) - Date.now() + 10)));

    timer.unref?.();
    expiryTimers.set(key, timer);
}

function clearExpiry(roomId, userId) {
    const key = timerKey(roomId, userId);
    clearTimeout(expiryTimers.get(key));
    expiryTimers.delete(key);
}

function retryAfter(roomId, userId, now = Date.now()) {
    const until = cooldowns.get(timerKey(roomId, userId))?.until || 0;
    return Math.max(0, Math.ceil((until - now) / 1000));
}

// Reserve slow mode synchronously across all sockets of the same user in this process.
function reserveMessage(roomId, userId, seconds) {
    if (!seconds) return;

    const key = timerKey(roomId, userId);
    clearTimeout(cooldowns.get(key)?.timer);
    const timer = setTimeout(() => cooldowns.delete(key), seconds * 1000);
    timer.unref?.();
    cooldowns.set(key, { until: Date.now() + seconds * 1000, timer });
}

function mediaKey(roomId, userId) { return timerKey(roomId, userId); }
function roomMediaKey(roomId) { return timerKey(roomId, { roomRemoval: true }); }
function getMediaJob(roomId, userId) { return mediaJobs.get(mediaKey(roomId, userId)); }
function getRoomMediaJob(roomId) { return mediaJobs.get(roomMediaKey(roomId)); }

// Coalesce pending media changes while preserving ordering for each participant.
function enqueueMedia(task) {
    const key = task.removeAll ? roomMediaKey(task.roomId) : mediaKey(task.roomId, task.userId);
    let job = mediaJobs.get(key);
    if (!job) {
        job = { key, running: false, attempts: 0, timer: null };
        mediaJobs.set(key, job);
    }

    if (job.task?.version && task.version && BigInt(task.version) < BigInt(job.task.version)) return;
    clearTimeout(job.timer);
    job.timer = null;
    job.task = task;
    if (!job.running) readyMedia.add(key);
}

function takeMediaJob() {
    if (activeMediaJobs >= 8 || !readyMedia.size) return null;

    const key = readyMedia.values().next().value;
    readyMedia.delete(key);
    const job = mediaJobs.get(key);
    job.running = true;
    activeMediaJobs++;
    return job;
}

// Retry failed media work only; there is no interval scanning rooms or participants.
function finishMediaJob(job, task, succeeded, resume) {
    job.running = false;
    activeMediaJobs--;

    if (job.task !== task) {
        readyMedia.add(job.key);
        return;
    }
    if (succeeded) {
        mediaJobs.delete(job.key);
        return;
    }

    const delay = Math.min(30000, 500 * (2 ** Math.min(job.attempts++, 6)));
    job.timer = setTimeout(() => { job.timer = null; readyMedia.add(job.key); resume(); }, delay);
    job.timer.unref?.();
}

function clearTimers() {
    for (const timer of expiryTimers.values()) clearTimeout(timer);
    for (const entry of cooldowns.values()) clearTimeout(entry.timer);
    for (const job of mediaJobs.values()) clearTimeout(job.timer);
    expiryTimers.clear();
    cooldowns.clear();
}

function clearRoomRevision(roomId) {
    const revision = roomRevisions.get(roomId);
    if (revision && roomAliases.get(revision.liveKitRoomName) === roomId) {
        roomAliases.delete(revision.liveKitRoomName);
    }
    roomRevisions.delete(roomId);
}

module.exports = {
    applySnapshot, observeRoomRevision, getRoomRevision, getRoomSuspension,
    getRoomMediaJob, clearRoomRevision, getRoom, getUser, addConnection, removeConnection,
    setExpiry, retryAfter, reserveMessage,
    getMediaJob, enqueueMedia, takeMediaJob, finishMediaJob, clearTimers
};

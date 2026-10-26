const liveRooms = new Map();
const micSpots = new Map();
const roomOperations = new Map();
const roomVersions = new Map();
let operationVersion = 0;

// يجمع الانضمام والإشراف في تسلسل واحد للغرفة حتى لا تُطبّق استجابة قديمة بعد أمر أحدث.
async function runRoomOperation(roomId, operation) {
    const previous = roomOperations.get(roomId) || Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
        try {
            return await operation();
        } finally {
            roomVersions.set(roomId, ++operationVersion);
        }
    });
    roomOperations.set(roomId, current);
    try {
        return await current;
    } finally {
        if (roomOperations.get(roomId) === current) roomOperations.delete(roomId);
    }
}

function getOperationVersion() { return operationVersion; }
function getRoomVersion(roomId) { return roomVersions.get(roomId) || 0; }

function getRoom(roomId) {
    return liveRooms.get(roomId);
}

function addRoomUser(roomId, socketId, user) {
    if (!liveRooms.has(roomId)) liveRooms.set(roomId, new Map());
    liveRooms.get(roomId).set(socketId, user);
}

function removeRoomUser(roomId, socketId) {
    const users = liveRooms.get(roomId);
    if (!users) return false;
    const removed = users.delete(socketId);
    if (users.size === 0) liveRooms.delete(roomId);
    return removed;
}

function getRoomUsers(roomId) {
    return Array.from(liveRooms.get(roomId)?.values() || []);
}

function getMicSpots(roomId) {
    return micSpots.get(roomId);
}

function setMicSpots(roomId, spots) {
    micSpots.set(roomId, spots);
}

function clearUserMic(roomId, userId) {
    const spots = micSpots.get(roomId);
    if (!spots) return false;

    let changed = false;
    for (const [spotNumber, user] of Object.entries(spots)) {
        if (user?.userId === userId) {
            delete spots[spotNumber];
            changed = true;
        }
    }
    return changed;
}

function clearRoomState(roomId) {
    if (!liveRooms.has(roomId)) micSpots.delete(roomId);
}

module.exports = {
    runRoomOperation,
    getOperationVersion,
    getRoomVersion,
    liveRooms,
    micSpots,
    getRoom,
    addRoomUser,
    removeRoomUser,
    getRoomUsers,
    getMicSpots,
    setMicSpots,
    clearUserMic,
    clearRoomState
};

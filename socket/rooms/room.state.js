const liveRooms = new Map();
const micSpots  = new Map();

function getRoom(roomId) {
    return liveRooms.get(roomId);
}

function getMicSpots(roomId) {
    return micSpots.get(roomId);
}

module.exports = {
    liveRooms,
    micSpots,
    getRoom,
    getMicSpots
};
const { liveRooms, micSpots } = require('../rooms/room.state');

function joinRoom(io, socket, { roomId, user }) {
    if (!liveRooms.has(roomId)) {
        liveRooms.set(roomId, new Set())
    }

    socket.join(roomId)
    socket.roomId = roomId
    socket.user = user

    //user.userId = socket.id // this is requiered
    user.socketId = socket.id

    const users = liveRooms.get(roomId)
    users.add(JSON.stringify(user)) // store user as string to use Set

    console.log("users joined");
    //console.log("users joined: " + socket.id + " room users: " + users.size + " total rooms : " + liveRooms.size);
    //console.log("list of users: " + JSON.stringify(Array.from(users).map(u => JSON.parse(u)), null, 2));

    // send updated user list to everyone in room
    io.to(roomId).emit('userList', Array.from(users).map(u => JSON.parse(u)))
    // socket.to(roomId).emit('userList', Array.from(users).map(u => JSON.parse(u)))

    // notify others (not sender) that new user joined
    // socket.to(roomId).emit('userJoined', user)
    // io.to(roomId).emit('userJoined', user)

    // send notification to other users about who in mic
    const roomMic = micSpots.get(roomId)
    if (!roomMic) return

    io.to(roomId).emit('micUpdate', { ...roomMic })

}

function requestMic(io, socket, { spotNumber }) {
    const roomId = socket.roomId
    const user = socket.user
    if (!roomId || !user || spotNumber > 7) return

    if (!micSpots.has(roomId)) {
        micSpots.set(roomId, {})
    }

    const roomMic = micSpots.get(roomId)

    if (roomMic[spotNumber]) {
        socket.emit('micRejected', { spotNumber, reason: 'تم أخذ المكان بالفعل' })
        //console.log("Request Mic rejected, [Spot already taken]" , spotNumber)
        return
    }

    // assign mic to user
    roomMic[spotNumber] = user

    // console.log("assign mic to user:" , spotNumber)

    // send command to the user to start speaking
    socket.emit("takeMic", { spotNumber })

    // notify all in room
    io.to(roomId).emit('micUpdate', { ...roomMic })
}

function leaveMic(io, socket, { spotNumber }) {
    const roomId = socket.roomId
    const user = socket.user
    if (!roomId || !user) return

    const roomMic = micSpots.get(roomId)
    if (!roomMic) return

    // send command to the user to start speaking
    socket.emit("leaveMic", { spotNumber })

    if (roomMic[spotNumber]?.userId === user.userId) {
        delete roomMic[spotNumber]
        io.to(roomId).emit('micUpdate', { ...roomMic })
    }
}

function audioData(io, socket, data) {
    //console.log("getting audio data")

    // Broadcast audio data to all other users in the room except the sender
    socket.broadcast.emit('audioData', { userId: socket.id, audio: data });
}

module.exports = {
    joinRoom,
    requestMic,
    leaveMic,
    audioData
};

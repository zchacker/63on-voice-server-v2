const { liveRooms, micSpots } = require('./room.state');

async function joinRoom(io, socket, { roomId, user }) {
    // validation
    // update room state
    // socket.join()
    // emit events

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

async function takeMic(io, socket, { roomId, userId, position }) {
    // check position
    // check permissions
    // update mic state
    // emit
}

module.exports = {
    joinRoom,
    takeMic
};
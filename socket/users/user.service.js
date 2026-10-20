const { liveRooms, micSpots } = require('../rooms/room.state');

function removeUser(io, socket, { roomId, targetUserId }) {
    const roomUsers = liveRooms.get(roomId)
    if (!roomUsers) return

    const targetUser = roomUsers.get(targetUserId)
    if (!targetUser) return

    // get socket of user to remove
    const targetSocketId = targetUser.socketId
    const targetSocket = io.sockets.sockets.get(targetSocketId)
    if (targetSocket) {
        // force user to leave room and notify them they were kicked
        targetSocket.leave(roomId)
        targetSocket.emit('kicked')
    }

    // remove user from room user list
    roomUsers.delete(targetUserId)

    // update user list for everyone in room
    io.to(roomId).emit('userList', Array.from(roomUsers.values()))

    // notify room that user was removed
    io.to(roomId).emit('userRemoved', { userId: targetUserId })

    // if room is empty, delete room
    if (roomUsers.size === 0) {
        liveRooms.delete(roomId)
    }
}

function disconnect(io, socket) {
    const roomId = socket.roomId
    const user = socket.user
    if (!roomId || !user) return

    const roomUsers = liveRooms.get(roomId)
    if (!roomUsers) return

    // remove from mic spots
    const roomMic = micSpots.get(roomId)
    if (roomMic) {
        for (let i = 0; i <= 6; i++) {
            if (roomMic[i]) {
                const userM = roomMic[i]// JSON.parse(roomMic[i]);
                if (userM?.userId === user.userId) {
                    delete roomMic[i]
                }
            }
        }
        io.to(roomId).emit('micUpdate', { ...roomMic })
    }

    // remove user from room user list
    // roomUsers.delete(user.userId)
    //liveRooms.get(roomId).delete(user.userId)

    // Find the user string that contains this userId
    for (const userStr of roomUsers) {
        const userE = JSON.parse(userStr);
        if (userE.userId === user.userId) {
            roomUsers.delete(userStr); // Delete the exact stringified version
            break;
        }
    }


    // update user list for everyone in room
    // io.to(roomId).emit('userList', Array.from(roomUsers.values()))
    io.to(roomId).emit('userList', Array.from(roomUsers).map(u => JSON.parse(u)))

    // notify others user left
    //socket.to(roomId).emit('userLeft', user)

    console.log("user leave room");

    // if room is empty, delete room
    // if (roomUsers.size === 0) {
    //     liveRooms.delete(roomId)
    // }
}

module.exports = {
    removeUser,
    disconnect
};

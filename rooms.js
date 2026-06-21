const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');  // Import CORS

const server = http.createServer();
const io = socketIo(server, {
    cors: {
        origin: '*',  // Allow all origins, you can specify your Apache server's URL instead
        methods: ['GET', 'POST']
    }
});

// storing rooms
const liveRooms = new Map() // roomId => Set of users
const micSpots = new Map() // roomId => { 1: userObj, 2: userObj, ..., 7: userObj }


io.on('connection', (socket) => {

    console.log('New connection');
    //liveRooms.clear()
    //micSpots.clear()

    socket.on('joinRoom', ({ roomId, user }) => {
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

    })

    socket.on('sendMessage', (message) => {
        const roomId = socket.roomId
        io.to(roomId).emit('newMessage', {
            message: message,
            user: socket.user
        })
    })

    socket.on('sendGift', (gift) => {
        const roomId = socket.roomId
        io.to(roomId).emit('sendGift', {
            gift: gift,
            user: socket.user
        })
    })

    // start speaking -> request mic    
    socket.on('requestMic', ({ spotNumber }) => {
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
    })


    // leave mic
    socket.on('leaveMic', ({ spotNumber }) => {
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
    })

    // admin removes a user from room
    socket.on('removeUser', ({ roomId, targetUserId }) => {
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
    })

    // handle disconnect (user closes browser/tab)
    socket.on('disconnect', () => {
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
    })


    socket.on('audioData', (data) => {
        //console.log("getting audio data")

        // Broadcast audio data to all other users in the room except the sender
        socket.broadcast.emit('audioData', { userId: socket.id, audio: data });
    });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
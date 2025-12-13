const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');  // Import CORS

const app = express();
const server = http.createServer(app);

// Use CORS middleware
app.use(cors());

// const io        = socketIo(server);
const io = socketIo(server, {
    cors: {
        origin: '*',  // Allow all origins, you can specify your Apache server's URL instead
        methods: ['GET', 'POST']
    }
});

// Store connected users
const users = {};

io.on('connection', (socket) => {    

    console.log('New connection');

    // Handle audio data
    socket.on('audioData', (data) => {
        //console.log("getting audio data")

        // send to all clients
        //io.emit('audioData', { userId: socket.id, audio: data })

        // Broadcast audio data to all other users in the room except the sender
        socket.broadcast.emit('audioData', { userId: socket.id, audio: data });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        delete users[socket.id];
        io.emit('userList', Object.values(users));
    });


    socket.on('addUser', (data) => {
        // console.log('New user connected: ID=%s , username=%s ', socket.id, socket.handshake.query.username);
        console.log('New user connected: ID=%s , username=%s ', socket.id, data.username );

        // Add new user to the users list
        // users[socket.id] = { id: socket.id, username: socket.handshake.query.username };
        users[socket.id] = { id: socket.id, username: data.username };
        io.emit('userList', Object.values(users));
    });

});

// Serve client files
app.use(express.static('public'));

app.get('/', function (req, res) {
    res.send("Hello world!");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

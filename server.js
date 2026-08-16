const http = require('http');
const { Server } = require('socket.io');

const socketEvents = require('./socket');

const server = http.createServer();

const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

socketEvents(io);// resgiter all socket events

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Socket server running on port ${PORT}`);
});
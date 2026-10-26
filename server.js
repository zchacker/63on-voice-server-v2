const path = require('path');

if (typeof process.loadEnvFile === 'function') {
    try {
        process.loadEnvFile(path.join(__dirname, '.env'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
}

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

socketEvents(io);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log('Socket server running on port ' + PORT);
});

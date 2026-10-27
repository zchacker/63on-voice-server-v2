const path = require('path');

if (typeof process.loadEnvFile === 'function') {
    try {
        process.loadEnvFile(path.join(__dirname, '.env'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
}

const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const socketEvents = require('./socket');
const { registerInternalHttpRoutes } = require('./services/internal-http.service');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

socketEvents(io);
registerInternalHttpRoutes(app, io);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log('Socket server running on port ' + PORT);
});

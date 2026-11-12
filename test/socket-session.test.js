const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const { Server } = require('socket.io');
const registerSocketEvents = require('../socket');
const roomState = require('../socket/rooms/room.state');
const moderationState = require('../socket/moderation/moderation.state');
const laravel = require('../services/laravel.service');

const SECRET = 'session-refresh-test-secret-'.repeat(2);
const START = 1800000000000;

function token(now, overrides = {}, secret = SECRET) {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({
        sub: '42', iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 60,
        jti: crypto.randomUUID(), iss: '63on-backend', aud: '63on-socket', ...overrides
    });
    return unsigned + '.' + crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
}

function connection(t, authenticated = true) {
    let now = START;
    t.mock.method(Date, 'now', () => now);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(laravel, 'notifyRoomPresence', async () => true);
    for (const [key, value] of Object.entries({
        SOCKET_JWT_SECRET: SECRET, SOCKET_JWT_ISSUER: '63on-backend', SOCKET_JWT_AUDIENCE: '63on-socket'
    })) {
        const previous = process.env[key];
        process.env[key] = value;
        t.after(() => previous === undefined ? delete process.env[key] : process.env[key] = previous);
    }

    const io = new EventEmitter();
    io.use = (handler) => { io.authenticate = handler; };
    io.broadcasts = [];
    io.to = (roomId) => ({ emit: (event, data) => io.broadcasts.push({ roomId, event, data }) });
    io.sockets = { sockets: new Map() };
    registerSocketEvents(io);

    const socket = new EventEmitter();
    socket.id = 'refresh-test-socket';
    socket.connected = true;
    socket.handshake = { auth: authenticated ? { token: token(now) } : {} };
    socket.use = (handler) => { socket.checkPacket = handler; };
    socket.leave = () => {};
    socket.disconnect = () => {
        socket.connected = false;
        socket.emit('disconnect');
    };
    socket.receive = (event, payload) => {
        const dispatch = () => socket.emit(event, payload);
        if (socket.checkPacket) socket.checkPacket([event, payload], dispatch);
        else dispatch();
    };
    io.authenticate(socket, (error) => assert.ifError(error));
    io.sockets.sockets.set(socket.id, socket);
    io.emit('connection', socket);
    t.after(() => { if (socket.connected) socket.disconnect(); });
    return {
        io, socket,
        advance(ms) { now += ms; t.mock.timers.tick(ms); },
        now: () => now
    };
}

test('registered refresh preserves room, seat and temporary role past the old expiry', (t) => {
    const { io, socket, advance, now } = connection(t);
    const roomId = 'session-refresh-room';
    socket.roomId = roomId;
    socket.user = { userId: '42', socketId: socket.id };
    roomState.addRoomUser(roomId, socket.id, socket.user);
    roomState.setMicSpots(roomId, { 0: socket.user });
    moderationState.promoteTemporary(roomId, '42');
    const originalUser = socket.user;
    const disconnectListeners = socket.listenerCount('disconnect');
    let confirmation;
    socket.on('socketSessionRefreshed', (result) => { confirmation = result; });

    advance(10000);
    const expiresAt = Math.floor(now() / 1000) + 180;
    socket.receive('refreshSocketSession', { token: token(now(), { exp: expiresAt }) });
    assert.deepEqual(confirmation, { userId: '42', expiresAt, expiresIn: 180 });
    assert.equal(socket.listenerCount('disconnect'), disconnectListeners);
    advance(50000);
    socket.receive('sendMessage', 'Still connected after the old expiry');
    assert.equal(io.broadcasts.at(-1).event, 'newMessage');
    assert.equal(socket.connected, true);
    assert.equal(socket.roomId, roomId);
    assert.equal(socket.user, originalUser);
    assert.equal(roomState.getMicSpots(roomId)[0], originalUser);
    assert.equal(moderationState.getRole(roomId, '42'), 'temporary');

    advance(130000);
    assert.equal(socket.connected, false);
    assert.equal(socket.roomId, null);
    assert.equal(roomState.getMicSpots(roomId), undefined);
    assert.equal(moderationState.getRole(roomId, '42'), 'normal');
    assert.equal(socket.authExpiryTimer, null);
});

test('invalid refreshes preserve the current identity, claims and expiry timer', (t) => {
    const { socket, advance, now } = connection(t);
    const claims = socket.authenticatedClaims;
    const timer = socket.authExpiryTimer;
    const exp = claims.exp + 60;
    const cases = [
        [null, 'INVALID_REFRESH_PAYLOAD'],
        [{ token: 123 }, 'INVALID_REFRESH_PAYLOAD'],
        [{ token: 'bad-token' }, 'INVALID_SOCKET_TOKEN'],
        [{ token: token(now(), { exp }, 'wrong-secret') }, 'INVALID_SOCKET_TOKEN'],
        [{ token: token(now(), { exp, iss: 'wrong' }) }, 'INVALID_SOCKET_TOKEN'],
        [{ token: token(now(), { exp, aud: 'wrong' }) }, 'INVALID_SOCKET_TOKEN'],
        [{ token: token(now(), { exp, nbf: exp }) }, 'INVALID_SOCKET_TOKEN'],
        [{ token: token(now(), { exp: claims.iat - 1 }) }, 'INVALID_SOCKET_TOKEN'],
        [{ token: token(now(), { exp: claims.iat + 601 }) }, 'INVALID_SOCKET_TOKEN'],
        [{ token: token(now(), { exp, sub: '99' }) }, 'SESSION_IDENTITY_MISMATCH'],
        [{ token: token(now()) }, 'SESSION_NOT_EXTENDED'],
        [{ token: token(now(), { exp: claims.exp - 1 }) }, 'SESSION_NOT_EXTENDED']
    ];
    let rejected;
    socket.on('socketSessionRefreshRejected', (result) => { rejected = result; });
    for (const [payload, code] of cases) {
        socket.receive('refreshSocketSession', payload);
        assert.equal(rejected.code, code);
        assert.equal(socket.authenticatedUserId, '42');
        assert.equal(socket.authenticatedClaims, claims);
        assert.equal(socket.authExpiryTimer, timer);
    }
    advance(60000);
    assert.equal(socket.connected, false);
});

test('refresh cannot authenticate a connection that opened without a token', (t) => {
    const { socket, now } = connection(t, false);
    let rejected;
    socket.on('socketSessionRefreshRejected', (result) => { rejected = result; });
    socket.receive('refreshSocketSession', { token: token(now()) });
    assert.equal(rejected.code, 'AUTHENTICATION_REQUIRED');
    assert.equal(socket.authenticatedUserId, undefined);
    assert.equal(socket.authExpiryTimer, undefined);
});

test('repeated renewal replaces the timer without adding disconnect listeners', (t) => {
    const { socket, advance, now } = connection(t);
    const listeners = socket.listenerCount('disconnect');
    for (let index = 0; index < 3; index++) {
        advance(30000);
        socket.receive('refreshSocketSession', { token: token(now()) });
        assert.equal(socket.connected, true);
        assert.equal(socket.listenerCount('disconnect'), listeners);
    }
    advance(60000);
    assert.equal(socket.connected, false);
});

test('packet expiry check blocks late refresh even if the timer has not run yet', (t) => {
    const { socket } = connection(t);
    const oldClaims = socket.authenticatedClaims;
    const lateNow = START + 61000;
    t.mock.method(Date, 'now', () => lateNow);
    let refreshed = false;
    socket.on('socketSessionRefreshed', () => { refreshed = true; });
    socket.receive('refreshSocketSession', { token: token(lateNow) });
    assert.equal(socket.connected, false);
    assert.equal(refreshed, false);
    assert.equal(socket.authenticatedClaims, oldClaims);
});

test('real Socket.IO transport refreshes without reconnecting or releasing the mic', { timeout: 10000 }, async (t) => {
    for (const [key, value] of Object.entries({
        SOCKET_JWT_SECRET: SECRET, SOCKET_JWT_ISSUER: '63on-backend', SOCKET_JWT_AUDIENCE: '63on-socket'
    })) {
        const previous = process.env[key];
        process.env[key] = value;
        t.after(() => previous === undefined ? delete process.env[key] : process.env[key] = previous);
    }
    t.mock.method(laravel, 'notifyRoomPresence', async () => true);
    t.mock.method(laravel, 'authorizeRoomJoin', async () => ({
        allowed: true,
        room: { id: '909', ownerId: '1', liveKitRoomName: 'session-test', messagesLocked: false },
        user: { id: '42', name: 'Session test' }, role: 'normal',
        moderation: { banned: false, micMuted: false }
    }));
    const server = http.createServer();
    const io = new Server(server);
    registerSocketEvents(io);
    t.after(() => new Promise((resolve) => io.close(resolve)));
    let connectedSocket;
    let connections = 0;
    io.on('connection', (socket) => { connectedSocket = socket; connections++; });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port + '/socket.io/?EIO=4&transport=polling';
    const handshake = await (await fetch(origin)).text();
    const sid = JSON.parse(handshake.slice(1)).sid;
    const url = origin + '&sid=' + sid;
    async function send(packet) {
        const response = await fetch(url, { method: 'POST', body: packet });
        assert.equal(response.status, 200);
        await response.text();
    }
    async function receive(event) {
        const response = await fetch(url);
        const packets = (await response.text()).split('\x1e');
        const events = packets.filter((packet) => packet.startsWith('42'))
            .map((packet) => JSON.parse(packet.slice(2)));
        assert.ok(events.some(([name]) => name === event), 'Expected event ' + event);
    }

    const now = Date.now();
    const oldExpiry = Math.floor(now / 1000) + 2;
    await send('40' + JSON.stringify({ token: token(now, { exp: oldExpiry }) }));
    assert.match(await (await fetch(url)).text(), /^40/);
    const originalSocketId = connectedSocket.id;
    await send('42' + JSON.stringify(['joinRoom', { roomId: '909' }]));
    await receive('userList');
    await send('42' + JSON.stringify(['requestMic', { spotNumber: 0 }]));
    await receive('takeMic');
    await send('42' + JSON.stringify(['refreshSocketSession', { token: token(Date.now()) }]));
    await receive('socketSessionRefreshed');
    await new Promise((resolve) => setTimeout(resolve, oldExpiry * 1000 - Date.now() + 50));
    await send('42' + JSON.stringify(['sendMessage', 'Message after the old expiry']));
    await receive('newMessage');
    assert.equal(connections, 1);
    assert.equal(connectedSocket.id, originalSocketId);
    assert.equal(connectedSocket.connected, true);
    assert.equal(connectedSocket.roomId, '909');
    assert.equal(roomState.getMicSpots('909')[0].socketId, originalSocketId);
});

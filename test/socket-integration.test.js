const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const laravel = require('../services/laravel.service');
const rooms = require('../socket/rooms/room.service');
const roomState = require('../socket/rooms/room.state');
const moderation = require('../socket/moderation/moderation.service');
const state = require('../socket/moderation/moderation.state');
const { verifyToken } = require('../socket/auth/socket.auth');

const originalAuthorize = laravel.authorizeRoomJoin;
const originalSave = laravel.saveModerationCommand;
const originalFetch = global.fetch;
const environment = { ...process.env };
test.afterEach(() => {
    laravel.authorizeRoomJoin = originalAuthorize;
    laravel.saveModerationCommand = originalSave;
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) {
        if (!(key in environment)) delete process.env[key];
    }
    Object.assign(process.env, environment);
});

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function createIo() {
    const broadcasts = [];
    return {
        broadcasts,
        sockets: { sockets: new Map() },
        to(roomId) {
            return { emit(event, data) { broadcasts.push({ roomId, event, data }); } };
        }
    };
}

function createSocket(io, id, userId, roomId = null) {
    const socket = {
        id,
        connected: true,
        authenticatedUserId: userId,
        roomId,
        user: roomId ? { userId, socketId: id } : null,
        events: [],
        joined: new Set(roomId ? [roomId] : []),
        emit(event, data) { this.events.push({ event, data }); },
        join(room) { this.joined.add(room); },
        leave(room) { this.joined.delete(room); }
    };
    io.sockets.sockets.set(id, socket);
    if (roomId) roomState.addRoomUser(roomId, id, socket.user);
    return socket;
}

function authorization(roomId, userId, { locked = false, muted = false } = {}) {
    return {
        allowed: true,
        room: { id: roomId, ownerId: '1', messagesLocked: locked },
        user: { id: userId, name: 'Verified user', avatar: null },
        role: userId === '1' ? 'owner' : 'normal',
        moderation: { banned: false, micMuted: muted }
    };
}

function success(command, snapshot = {}) {
    return {
        requestId: command.requestId,
        success: true,
        state: { banned: false, role: 'normal', micMuted: false, messagesLocked: false, ...snapshot }
    };
}

test('Laravel JWT proves identity and rejects a different signing key', () => {
    const secret = 'test-jwt-secret-'.repeat(3);
    const now = Math.floor(Date.now() / 1000);
    process.env.SOCKET_JWT_ISSUER = '63on-backend';
    process.env.SOCKET_JWT_AUDIENCE = '63on-socket';
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({
        sub: '42', iat: now, exp: now + 600, jti: crypto.randomUUID(),
        iss: '63on-backend', aud: '63on-socket'
    });
    const token = unsigned + '.' + crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
    assert.equal(verifyToken(token, secret).sub, '42');
    assert.throws(() => verifyToken(token, 'different-secret-'.repeat(3)), /signature/);
});

test('join requires JWT identity before calling Laravel', async () => {
    const io = createIo();
    const socket = createSocket(io, 'unauthenticated', undefined);
    let calls = 0;
    laravel.authorizeRoomJoin = async () => { calls++; };
    await rooms.joinRoom(io, socket, { roomId: 10, user: { userId: '1', role: 'owner' } });
    assert.equal(calls, 0);
    assert.equal(socket.events.at(-1).data.code, 'AUTHENTICATION_REQUIRED');
});

test('numeric ID and username resolve to one room; client profile is ignored', async () => {
    const io = createIo();
    laravel.authorizeRoomJoin = async (_requested, userId) => authorization('test-canonical', userId);
    const first = createSocket(io, 'canonical-a', '42');
    const second = createSocket(io, 'canonical-b', '43');
    await rooms.joinRoom(io, first, { roomId: 10, user: { userId: '1', name: 'Forged', role: 'owner' } });
    await rooms.joinRoom(io, second, { roomId: 'room-username' });
    assert.equal(first.roomId, 'test-canonical');
    assert.equal(second.roomId, first.roomId);
    assert.equal(roomState.getRoomUsers(first.roomId).length, 2);
    assert.equal(first.user.userId, '42');
    assert.equal(first.user.name, 'Verified user');

    const owner = createSocket(io, 'canonical-owner', '1');
    await rooms.joinRoom(io, owner, { roomId: 'room-username' });
    laravel.saveModerationCommand = async (roomId, command) => {
        assert.equal(roomId, 'test-canonical');
        return success(command, { messagesLocked: true });
    };
    await moderation.handleModeration(io, owner, 'lockMessages', { roomId: 'room-username' });
    assert.equal(owner.events.at(-1).data.roomId, 'test-canonical');
    assert.equal(owner.events.at(-1).data.success, true);
});

test('join refreshes a snapshot older than a confirmed lock and mute', async () => {
    const io = createIo();
    const room = 'test-stale';
    const actor = createSocket(io, 'stale-owner', '1', room);
    state.setPersistentRole(room, '1', 'owner');
    const member = createSocket(io, 'stale-member', '42');
    const oldSnapshot = deferred();
    let authorizationCalls = 0;
    laravel.authorizeRoomJoin = async () => {
        authorizationCalls++;
        return authorizationCalls === 1
            ? oldSnapshot.promise
            : authorization(room, '42', { locked: true, muted: true });
    };
    laravel.saveModerationCommand = async (_room, command) =>
        success(command, { messagesLocked: true, micMuted: command.action === 'mute_mic' });
    const pendingJoin = rooms.joinRoom(io, member, { roomId: room });
    await moderation.handleModeration(io, actor, 'lockMessages', { roomId: room });
    await moderation.handleModeration(io, actor, 'muteMic', { roomId: room, targetUserId: '42' });
    oldSnapshot.resolve(authorization(room, '42'));
    await pendingJoin;
    assert.equal(authorizationCalls, 2);
    assert.equal(state.areMessagesLocked(room), true);
    assert.equal(state.isUserMuted(room, '42'), true);
});

test('confirmed lock is applied even when the actor leaves during the request', async () => {
    const io = createIo();
    const room = 'test-disconnected-owner';
    const actor = createSocket(io, 'disconnect-owner', '1', room);
    state.setPersistentRole(room, '1', 'owner');
    const started = deferred();
    const response = deferred();
    laravel.saveModerationCommand = async (_room, command) => {
        started.resolve(command);
        return response.promise;
    };
    const operation = moderation.handleModeration(io, actor, 'lockMessages', { roomId: room });
    const command = await started.promise;
    rooms.leaveRoom(io, actor);
    response.resolve(success(command, { messagesLocked: true }));
    await operation;
    assert.equal(state.areMessagesLocked(room), true);
    assert.equal(actor.events.at(-1).data.success, true);
    const broadcast = io.broadcasts.find((item) => item.event === 'messageLockUpdated');
    assert.equal(broadcast.data.changedBy, '1');
});

test('a pending join through an alias cannot enter after a confirmed ban', async () => {
    const io = createIo();
    const room = 'test-ban-race';
    const actor = createSocket(io, 'ban-owner', '1', room);
    state.setPersistentRole(room, '1', 'owner');
    const member = createSocket(io, 'ban-member', '42');
    const oldSnapshot = deferred();
    let calls = 0;
    laravel.authorizeRoomJoin = async () => {
        if (++calls === 1) return oldSnapshot.promise;
        throw new laravel.LaravelServiceError('USER_BANNED', 'Banned.', 403);
    };
    laravel.saveModerationCommand = async (_room, command) => success(command, { banned: true });
    const pending = rooms.joinRoom(io, member, { roomId: 'different-room-alias' });
    await moderation.handleModeration(io, actor, 'banUser', { roomId: room, targetUserId: '42' });
    oldSnapshot.resolve(authorization(room, '42'));
    await pending;
    assert.equal(member.roomId, null);
    assert.equal(member.events.at(-1).data.code, 'USER_BANNED');
});

function configureAdapter() {
    process.env.SOCKET_LARAVEL_API_BASE_URL = 'https://test.invalid';
    process.env.SOCKET_JWT_SECRET = 'test-jwt-secret-'.repeat(3);
    process.env.SOCKET_INTERNAL_SERVICE_TOKEN = 'test-service-secret-'.repeat(3);
}

test('lost moderation response retries the identical UUID and payload', async () => {
    configureAdapter();
    const sent = [];
    global.fetch = async (_url, options) => {
        const command = JSON.parse(options.body);
        sent.push(command);
        if (sent.length === 1) {
            const error = new Error('Response lost after commit');
            error.name = 'AbortError';
            throw error;
        }
        return { ok: true, status: 200, text: async () => JSON.stringify(success(command, { banned: true })) };
    };
    const command = { requestId: crypto.randomUUID(), action: 'ban', actorUserId: '1', actorRole: 'owner', targetUserId: '42' };
    const response = await originalSave('10', command);
    assert.equal(response.success, true);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0], sent[1]);
});

test('unknown command outcome suspends members and reuses the pending UUID before re-entry', async () => {
    const io = createIo();
    const room = 'test-uncertain';
    const actor = createSocket(io, 'uncertain-owner', '1', room);
    const member = createSocket(io, 'uncertain-member', '42', room);
    state.setPersistentRole(room, '1', 'owner');
    let pendingCommand;
    laravel.saveModerationCommand = async (_room, command) => {
        pendingCommand = command;
        throw new laravel.LaravelServiceError('LARAVEL_TIMEOUT', 'Unknown outcome.', 504);
    };
    await moderation.handleModeration(io, actor, 'banUser', { roomId: room, targetUserId: '42' });
    assert.equal(actor.roomId, null);
    assert.equal(member.roomId, null);
    assert.equal(actor.events.at(-1).data.success, false);
    assert.equal(state.getPendingCommand(room).command.requestId, pendingCommand.requestId);

    laravel.authorizeRoomJoin = async () => authorization(room, '1');
    const originalRequestId = pendingCommand.requestId;
    await rooms.joinRoom(io, actor, { roomId: room });
    assert.equal(actor.roomId, null);
    laravel.saveModerationCommand = async (_room, command) => {
        assert.equal(command.requestId, originalRequestId);
        return success(command, { banned: true });
    };
    await rooms.joinRoom(io, actor, { roomId: room });
    assert.equal(actor.roomId, room);
    assert.equal(state.getPendingCommand(room), undefined);
    assert.equal(member.roomId, null);
});

test('adapter keeps requestId mismatch protection', async () => {
    configureAdapter();
    global.fetch = async () => ({
        ok: true, status: 200,
        text: async () => JSON.stringify({ requestId: 'wrong-id', success: true, state: {} })
    });
    await assert.rejects(
        originalSave('10', { requestId: crypto.randomUUID(), action: 'lock_messages' }),
        (error) => error.code === 'INVALID_LARAVEL_RESPONSE'
    );
});

test('exhausted network retries remain bounded and retain the same command', async () => {
    configureAdapter();
    const sent = [];
    global.fetch = async (_url, options) => {
        sent.push(JSON.parse(options.body));
        throw new Error('Network unavailable');
    };
    const command = { requestId: crypto.randomUUID(), action: 'lock_messages' };
    await assert.rejects(originalSave('10', command), (error) => error.code === 'LARAVEL_UNAVAILABLE');
    assert.equal(sent.length, 3);
    assert.ok(sent.every((item) => item.requestId === command.requestId));
});

test('definitive Laravel rejection resolves an uncertain command without blocking room access forever', async () => {
    const io = createIo();
    const room = 'test-definitive-rejection';
    const member = createSocket(io, 'recovered-member', '42');
    state.rememberPendingCommand(room, {
        roomIdentifier: room,
        command: { requestId: crypto.randomUUID(), action: 'lock_messages', actorUserId: '1' }
    });
    laravel.authorizeRoomJoin = async () => authorization(room, '42');
    laravel.saveModerationCommand = async () => {
        throw new laravel.LaravelServiceError('FORBIDDEN', 'No command was stored.', 403);
    };
    await rooms.joinRoom(io, member, { roomId: room });
    assert.equal(member.roomId, room);
    assert.equal(state.getPendingCommand(room), undefined);
});

test('leaving cancels an outstanding join without creating phantom membership', async () => {
    const io = createIo();
    const room = 'test-cancelled-join';
    const member = createSocket(io, 'cancelled-member', '42');
    const response = deferred();
    laravel.authorizeRoomJoin = async () => response.promise;
    const pending = rooms.joinRoom(io, member, { roomId: room });
    rooms.leaveRoom(io, member);
    response.resolve(authorization(room, '42'));
    await pending;
    assert.equal(member.roomId, null);
    assert.equal(roomState.getRoomUsers(room).length, 0);
});

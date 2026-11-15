const test = require('node:test');
const assert = require('node:assert/strict');
const { RoomServiceClient } = require('livekit-server-sdk');
const laravel = require('../services/laravel.service');
const livekit = require('../services/livekit.service');
const policy = require('../socket/rooms/room-policy.service');
const state = require('../socket/rooms/room-policy.state');
const moderation = require('../socket/moderation/moderation.state');
const roomState = require('../socket/rooms/room.state');
const rooms = require('../socket/rooms/room.service');
const chat = require('../socket/chat/chat.service');
const fixture = require('./helpers/room-policy');
let nextRoom = 700;

function connection(t, io, roomId, userId = '42', options = {}) {
    const socket = {
        id: 'socket-' + Math.random(), roomId, authenticatedUserId: userId,
        liveKitRoomName: 'livekit-' + roomId, connected: true,
        user: { userId }, events: [],
        roomPolicy: fixture.response(roomId, userId, options).data,
        emit(event, data) { this.events.push({ event, data }); },
        leave() {}, disconnect() { this.connected = false; }
    };
    io.sockets.sockets.set(socket.id, socket);
    roomState.addRoomUser(roomId, socket.id, socket.user);
    policy.syncJoinedParticipant(io, socket);
    t.after(() => {
        state.removeConnection(roomId, userId, socket.id);
        roomState.removeRoomUser(roomId, socket.id);
        moderation.clearRoom(roomId);
    });
    return socket;
}

function environment() {
    const broadcasts = [];
    return {
        roomId: String(nextRoom++), broadcasts,
        sockets: { sockets: new Map() },
        to: (roomId) => ({ emit: (event, data) => broadcasts.push({ roomId, event, data }) })
    };
}

test.beforeEach((t) => {
    t.mock.method(laravel, 'readRoomPolicy', async () => { throw new Error('Unexpected policy HTTP request'); });
    t.mock.method(laravel, 'authorizeMessage', async () => { throw new Error('Unexpected message HTTP request'); });
    t.mock.method(laravel, 'notifyRoomPresence', async () => true);
    t.mock.method(livekit, 'updateParticipantPermissions', async () => ({ updated: true }));
    t.mock.method(livekit, 'removeActiveParticipant', async () => ({ removed: true }));
});
test.afterEach(() => state.clearTimers());

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('messages and microphone reservations use memory and bypass a blocked room queue', async (t) => {
    const io = environment();
    const socket = connection(t, io, io.roomId);
    let release;
    const blocked = roomState.runRoomOperation(io.roomId, () => new Promise((resolve) => { release = resolve; }));
    await flush();

    chat.sendMessage(io, socket, 'hello');
    rooms.requestMic(io, socket, { spotNumber: 0 });
    assert.ok(io.broadcasts.some((event) => event.event === 'newMessage'));
    assert.ok(socket.events.some((event) => event.event === 'takeMic'));
    assert.equal(laravel.readRoomPolicy.mock.callCount(), 0);
    assert.equal(laravel.authorizeMessage.mock.callCount(), 0);

    release();
    await blocked;
});

test('slow mode is shared across a user connections, while validation failures consume nothing', (t) => {
    const io = environment();
    const options = { settings: { message_interval_seconds: 10, message_max_length: 5 } };
    const first = connection(t, io, io.roomId, '42', options);
    const second = connection(t, io, io.roomId, '42', options);

    chat.sendMessage(io, first, 'too long');
    chat.sendMessage(io, first, 'hello');
    chat.sendMessage(io, second, 'hello');
    assert.equal(io.broadcasts.filter((event) => event.event === 'newMessage').length, 1);
    assert.equal(second.events.at(-1).data.code, 'SLOW_MODE');
    assert.equal(second.events.at(-1).data.retry_after, 10);
});

test('Unicode length, visitor links, staff exemptions and message locks are enforced locally', (t) => {
    const io = environment();
    const guest = connection(t, io, io.roomId, '42', { settings: { visitor_links_allowed: false } });
    chat.sendMessage(io, guest, 'مثال.إختبار');
    assert.equal(guest.events.at(-1).data.code, 'LINKS_DISABLED');

    policy.applyUpdate(io, io.roomId, fixture.snapshot(io.roomId, null, {
        version: '1', locked: true, settings: { message_max_length: 2 }
    }));
    chat.sendMessage(io, guest, 'ok');
    assert.equal(guest.events.at(-1).data.code, 'MESSAGES_DISABLED');

    const owner = connection(t, io, io.roomId, '1', { version: '1', locked: true, settings: { message_max_length: 2 } });
    chat.sendMessage(io, owner, '😀😀');
    assert.ok(io.broadcasts.some((event) => event.event === 'newMessage' && event.data.message === '😀😀'));
    chat.sendMessage(io, owner, '😀😀😀');
    assert.equal(owner.events.at(-1).data.code, 'MESSAGE_TOO_LONG');
});

test('members-only changes gate new admission without expelling or disabling existing visitors', (t) => {
    const io = environment();
    const socket = connection(t, io, io.roomId);
    const update = fixture.snapshot(io.roomId, null, { version: '2', settings: { members_only: true } });
    policy.applyUpdate(io, io.roomId, update);

    assert.equal(socket.connected, true);
    assert.equal(policy.currentPolicy(io.roomId, '42').permissions.can_message, true);
    assert.equal(policy.validateAdmission(io.roomId, fixture.snapshot(io.roomId, '43')), 'MEMBERS_ONLY');
});

test('targeted updates do not notify unrelated users, and stale per-user events cannot restore privileges', (t) => {
    const io = environment();
    const first = connection(t, io, io.roomId, '42');
    const second = connection(t, io, io.roomId, '43');
    const count = second.events.length;

    policy.applyUpdate(io, io.roomId, fixture.snapshot(io.roomId, '42', { version: '3', user: { messages_muted: true } }));
    policy.applyUpdate(io, io.roomId, fixture.snapshot(io.roomId, '43', { version: '2', user: { mic_muted: true } }));
    policy.applyUpdate(io, io.roomId, fixture.snapshot(io.roomId, '42', { version: '1' }));
    assert.equal(policy.currentPolicy(io.roomId, '42').permissions.can_message, false);
    assert.equal(policy.currentPolicy(io.roomId, '43').permissions.can_publish, false);
    assert.ok(second.events.length > count);
    assert.ok(first.connected);
});

test('a blocked LiveKit update does not delay policy application or message delivery', async (t) => {
    const io = environment();
    const socket = connection(t, io, io.roomId);
    await flush();
    let release;
    livekit.updateParticipantPermissions = () => new Promise((resolve) => { release = resolve; });

    policy.applyUpdate(io, io.roomId, fixture.snapshot(io.roomId, '42', { version: '1', user: { mic_muted: true } }));
    chat.sendMessage(io, socket, 'still fast');
    assert.equal(socket.roomPolicy.permissions.can_publish, false);
    assert.ok(io.broadcasts.some((event) => event.event === 'newMessage'));

    release({ updated: true });
    await flush();
});

test('ban notification precedes socket disconnection and records the departure', async (t) => {
    const io = environment();
    const socket = connection(t, io, io.roomId);
    socket.disconnect = () => {
        assert.ok(socket.events.some((event) => event.event === 'kicked'));
        socket.connected = false;
    };

    policy.applyUpdate(io, io.roomId, fixture.snapshot(io.roomId, '42', { version: '1', user: { banned: true } }));
    assert.equal(socket.connected, false);
    assert.equal(socket.roomId, null);
    assert.equal(laravel.notifyRoomPresence.mock.calls.at(-1).arguments[1].leaveReason, 'ban');
    await flush();
    assert.ok(livekit.removeActiveParticipant.mock.callCount() >= 1);
});

test('only the affected mute deadline schedules an expiry update, without Laravel requests', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const originalNow = Date.now();
    let now = originalNow;
    t.mock.method(Date, 'now', () => now);
    const io = environment();
    const socket = connection(t, io, io.roomId, '42', { user: {
        messages_muted: true, messages_muted_until: new Date(now + 1000).toISOString()
    } });
    assert.equal(socket.roomPolicy.permissions.can_message, false);

    now += 1010;
    t.mock.timers.tick(1010);
    assert.equal(socket.roomPolicy.permissions.can_message, true);
    assert.equal(laravel.readRoomPolicy.mock.callCount(), 0);
    await flush();
});

test('malformed snapshots and mismatched identities fail closed', async (t) => {
    const io = environment();
    assert.throws(() => policy.applyUpdate(io, io.roomId, {}), { code: 'INVALID_LARAVEL_POLICY' });
    const value = fixture.response(io.roomId, '43');
    laravel.readRoomPolicy = async () => value;
    await assert.rejects(policy.readPolicy(io.roomId, { user_id: '42' }), { code: 'INVALID_LARAVEL_IDENTITY' });
});

test('LiveKit reads one participant and preserves hidden/recorder grants', async (t) => {
    for (const [key, value] of Object.entries({ LIVEKIT_URL: 'wss://example.invalid', LIVEKIT_API_KEY: 'test', LIVEKIT_API_SECRET: 'test-secret' })) {
        const previous = process.env[key]; process.env[key] = value;
        t.after(() => previous === undefined ? delete process.env[key] : process.env[key] = previous);
    }
    livekit.updateParticipantPermissions.mock.restore();
    const get = t.mock.method(RoomServiceClient.prototype, 'getParticipant', async () => ({ identity: '42',
        permission: { canPublish: true, canPublishData: true, canSubscribe: true, hidden: true, recorder: true } }));
    const update = t.mock.method(RoomServiceClient.prototype, 'updateParticipant', async () => ({}));

    await livekit.updateParticipantPermissions('trusted-room', '42', { can_publish: false, direct_data_allowed: false });
    assert.equal(get.mock.callCount(), 1);
    assert.equal(update.mock.calls[0].arguments[2].permission.hidden, true);
    assert.equal(update.mock.calls[0].arguments[2].permission.canPublish, false);
});

test('media updates have bounded concurrency and coalesce the latest participant permissions', async (t) => {
    const io = environment();
    const resolvers = [];
    let active = 0;
    let peak = 0;
    livekit.updateParticipantPermissions = async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => resolvers.push(resolve));
        active--;
    };

    const sockets = Array.from({ length: 12 }, (_, index) => connection(t, io, io.roomId, String(index + 50)));
    assert.equal(peak, 8);
    policy.applyUpdate(io, io.roomId, fixture.snapshot(io.roomId, '50', { version: '1', user: { mic_muted: true } }));
    policy.applyUpdate(io, io.roomId, fixture.snapshot(io.roomId, '50', { version: '2' }));

    while (resolvers.length || active) {
        for (const resolve of resolvers.splice(0)) resolve();
        await flush();
    }
    assert.equal(peak, 8);
    assert.equal(sockets[0].roomPolicy.permissions.can_publish, true);
});

test('last temporary moderator departure uses cached policy to revoke media privileges', async (t) => {
    const io = environment();
    const socket = connection(t, io, io.roomId, '42', { settings: { visitor_mic_allowed: false } });
    await flush();
    moderation.promoteTemporary(io.roomId, '42');
    policy.refreshUser(io, io.roomId, '42');
    await flush();
    assert.equal(socket.roomPolicy.permissions.can_publish, true);

    rooms.leaveRoom(io, socket);
    await flush();
    assert.equal(livekit.updateParticipantPermissions.mock.calls.at(-1).arguments[2].can_publish, false);
    assert.equal(laravel.readRoomPolicy.mock.callCount(), 0);
});

test('cached microphone permissions cannot be used by a mismatched connection identity', (t) => {
    const io = environment();
    const socket = connection(t, io, io.roomId);
    socket.user = { userId: '43' };

    rooms.requestMic(io, socket, { spotNumber: 0 });
    assert.equal(socket.events.at(-1).data.code, 'AUTHENTICATION_REQUIRED');
    assert.equal(laravel.readRoomPolicy.mock.callCount(), 0);
});

test('HTTP policy ingress applies snapshots, rejects invalid input and accepts full Unicode rules', async (t) => {
    const http = require('node:http');
    const app = require('express')();
    const io = environment();
    const socket = connection(t, io, io.roomId);
    const token = 'policy-delivery-token-'.repeat(3);
    const previousToken = process.env.SOCKET_INTERNAL_SERVICE_TOKEN;
    process.env.SOCKET_INTERNAL_SERVICE_TOKEN = token;
    t.after(() => previousToken === undefined ? delete process.env.SOCKET_INTERNAL_SERVICE_TOKEN : process.env.SOCKET_INTERNAL_SERVICE_TOKEN = previousToken);
    require('../services/internal-http.service').registerInternalHttpRoutes(app, io);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const url = 'http://127.0.0.1:' + server.address().port + '/internal/socket/v1/rooms/' + io.roomId + '/policy-refresh';
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };

    const update = fixture.snapshot(io.roomId, '42', { version: '1', user: { messages_muted: true } });
    const accepted = await fetch(url, { method: 'POST', headers, body: JSON.stringify(update) });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).version, '1');
    assert.equal(socket.roomPolicy.permissions.can_message, false);
    assert.equal((await fetch(url, { method: 'POST', headers, body: '{}' })).status, 422);
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);

    const large = fixture.snapshot(io.roomId, null, { version: '2', settings: {
        rules: '😀'.repeat(10000), welcome_message: '😀'.repeat(1000)
    } });
    const escaped = JSON.stringify(large).replace(/[\u007f-\uffff]/g, (character) => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
    assert.ok(escaped.length > 128 * 1024);
    const response = await fetch(url, { method: 'POST', headers, body: escaped });
    assert.equal(response.status, 200);
    await response.json();
});

test('temporary moderator promotion refreshes only the target without any policy HTTP request', async (t) => {
    const io = environment();
    const owner = connection(t, io, io.roomId, '1');
    const target = connection(t, io, io.roomId, '42');
    const unrelated = connection(t, io, io.roomId, '43');
    const eventCount = unrelated.events.length;
    t.mock.method(laravel, 'startModerationAudit', async (event) => ({ requestId: event.requestId, status: 'started' }));
    t.mock.method(laravel, 'completeModerationAudit', async (event) => ({ requestId: event.requestId, status: 'completed' }));

    await require('../socket/moderation/moderation.service').handleModeration(io, owner, 'promoteTemporaryModerator', {
        roomId: io.roomId, targetUserId: '42'
    });

    assert.equal(owner.events.at(-1).data.success, true);
    assert.equal(target.roomPolicy.permissions.role, 'temporary_moderator');
    assert.equal(unrelated.events.length, eventCount);
    assert.equal(laravel.readRoomPolicy.mock.callCount(), 0);
});

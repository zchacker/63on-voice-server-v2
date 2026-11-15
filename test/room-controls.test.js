const test = require('node:test');
const assert = require('node:assert/strict');
const laravel = require('../services/laravel.service');
const livekit = require('../services/livekit.service');
const policy = require('../socket/rooms/room-policy.service');
const moderation = require('../socket/moderation/moderation.state');
const rooms = require('../socket/rooms/room.service');
const chat = require('../socket/chat/chat.service');
const roomState = require('../socket/rooms/room.state');
const { RoomServiceClient } = require('livekit-server-sdk');

function fixture() {
    const broadcasts = [];
    const io = { sockets: { sockets: new Map() }, to: (roomId) => ({ emit: (event, data) => broadcasts.push({ roomId, event, data }) }) };
    const socket = { id: 'controls-socket', roomId: '700', authenticatedUserId: '42', liveKitRoomName: 'trusted-room',
        connected: true, user: { userId: '42' }, events: [],
        emit(event, data) { this.events.push({ event, data }); }, leave() {}, disconnect() { this.connected = false; } };
    io.sockets.sockets.set(socket.id, socket);
    roomState.addRoomUser('700', socket.id, socket.user);
    return { io, socket, broadcasts };
}
function response(permissions = {}, next_change_at = null) {
    return { data: { room_id: '700', settings: {}, next_change_at,
        permissions: { entry_error: null, role: 'normal', can_publish: true, can_message: true, direct_data_allowed: true, ...permissions } } };
}
test.afterEach(() => { moderation.clearRoom('700'); roomState.liveRooms.delete('700'); roomState.micSpots.delete('700'); require('../socket/rooms/room-policy.state').clearExpiryTimers(); });

test('message authorization uses trusted temporary role, denies and forwards slow mode', async (t) => {
    const { io, socket, broadcasts } = fixture();
    moderation.promoteTemporary('700', '42');
    t.mock.method(laravel, 'authorizeMessage', async (roomId, identity, message) => {
        assert.equal(roomId, '700');
        assert.deepEqual(identity, { user_id: '42', role: 'temporary_moderator' });
        assert.equal(message, 'hello');
        const error = new laravel.LaravelServiceError('SLOW_MODE', 'Wait.', 429);
        error.retry_after = 4;
        throw error;
    });
    await chat.sendMessage(io, socket, 'hello');
    assert.equal(broadcasts.length, 0);
    assert.equal(socket.events.at(-1).data.retry_after, 4);
    assert.equal(socket.events.at(-1).data.code, 'SLOW_MODE');
});

test('only explicit allowed true broadcasts, and a departed connection cannot broadcast late', async (t) => {
    const { io, socket, broadcasts } = fixture();
    t.mock.method(laravel, 'authorizeMessage', async () => ({ allowed: 'true' }));
    await chat.sendMessage(io, socket, 'hello');
    assert.equal(broadcasts.length, 0);
    laravel.authorizeMessage = async () => ({ allowed: true });
    await chat.sendMessage(io, socket, 'hello');
    assert.equal(broadcasts.length, 1);
    laravel.authorizeMessage = async () => { socket.roomId = null; return { allowed: true }; };
    await chat.sendMessage(io, socket, 'hello');
    assert.equal(broadcasts.length, 1);
});

test('HTTP 200 policy entry denial prevents joining and presence', async (t) => {
    const { io, socket } = fixture();
    t.mock.method(laravel, 'notifyRoomPresence', async () => true);
    rooms.leaveRoom(io, socket);
    t.mock.method(laravel, 'authorizeRoomJoin', async () => ({ allowed: true,
        room: { id: '700', ownerId: '1', messagesLocked: false, liveKitRoomName: 'trusted-room' },
        user: { id: '42', name: 'Trusted' }, role: 'normal', moderation: { banned: false, micMuted: false } }));
    t.mock.method(laravel, 'readRoomPolicy', async () => response({ entry_error: 'MEMBERS_ONLY' }));
    const presence = t.mock.method(laravel, 'notifyRoomPresence', async () => true);
    await rooms.joinRoom(io, socket, { roomId: '700', role: 'owner', userId: '1' });
    assert.equal(socket.roomId, null);
    assert.equal(socket.events.at(-1).data.code, 'MEMBERS_ONLY');
    assert.equal(presence.mock.callCount(), 0);
});

test('refresh updates effective mute, restores it after expiry and preserves current membership', async (t) => {
    const { io, socket } = fixture();
    let publish = false;
    t.mock.method(laravel, 'readRoomPolicy', async () => response({ can_publish: publish }));
    const updates = t.mock.method(livekit, 'updateParticipantPermissions', async () => ({ updated: true }));
    await policy.refreshRoom(io, '700');
    assert.equal(moderation.isUserMuted('700', '42'), true);
    publish = true;
    await policy.refreshRoom(io, '700');
    assert.equal(moderation.isUserMuted('700', '42'), false);
    assert.equal(updates.mock.callCount(), 2);
    assert.equal(socket.roomId, '700');
});

test('REST ban disconnects all sockets and records ban even when LiveKit fails', async (t) => {
    const { io, socket } = fixture();
    t.mock.method(laravel, 'readRoomPolicy', async () => response({ entry_error: 'USER_BANNED', can_publish: false }));
    const presence = t.mock.method(laravel, 'notifyRoomPresence', async () => true);
    t.mock.method(livekit, 'removeActiveParticipant', async () => { throw new Error('offline'); });
    await assert.rejects(policy.refreshRoom(io, '700'), { code: 'ROOM_POLICY_SYNC_FAILED' });
    assert.equal(socket.roomId, null);
    assert.equal(socket.connected, false);
    assert.equal(presence.mock.calls[0].arguments[1].leaveReason, 'ban');
    const state = require('../socket/rooms/room-policy.state');
    assert.ok(state.getPendingRemovals().some((target) => target.identity === '42'));
    state.clearRemoval('trusted-room', '42');
});

test('LiveKit SDK updates publishing permissions and preserves hidden/recorder grants', async (t) => {
    for (const [key, value] of Object.entries({ LIVEKIT_URL: 'wss://example.invalid', LIVEKIT_API_KEY: 'test', LIVEKIT_API_SECRET: 'test-secret' })) {
        const previous = process.env[key]; process.env[key] = value;
        t.after(() => previous === undefined ? delete process.env[key] : process.env[key] = previous);
    }
    t.mock.method(RoomServiceClient.prototype, 'listParticipants', async () => [{ identity: '42', permission: { canPublish: true, canPublishData: true, canSubscribe: true, hidden: true, recorder: true } }]);
    const update = t.mock.method(RoomServiceClient.prototype, 'updateParticipant', async () => ({}));
    await livekit.updateParticipantPermissions('trusted-room', '42', { can_publish: false, direct_data_allowed: false });
    assert.deepEqual(update.mock.calls[0].arguments, ['trusted-room', '42', { permission: { canPublish: false, canPublishData: false, canSubscribe: true, hidden: true, recorder: true } }]);
});

test('expiry timer rechecks the authoritative policy at the deadline', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const state = require('../socket/rooms/room-policy.state');
    let called = 0;
    state.setExpiryTimer('700', new Date(Date.now() + 1000).toISOString(), () => called++);
    t.mock.timers.tick(999);
    assert.equal(called, 0);
    t.mock.timers.tick(100);
    assert.equal(called, 1);
});

test('last temporary role departure reconciles detached LiveKit without trusting old role', async (t) => {
    const { io, socket } = fixture();
    moderation.promoteTemporary('700', '42');
    let resolveUpdate;
    const updated = new Promise((resolve) => { resolveUpdate = resolve; });
    t.mock.method(laravel, 'notifyRoomPresence', async () => true);
    t.mock.method(laravel, 'readRoomPolicy', async (_roomId, identity) => {
        assert.deepEqual(identity, { user_id: '42' });
        return response({ can_publish: false, direct_data_allowed: false });
    });
    const update = t.mock.method(livekit, 'updateParticipantPermissions', async () => { resolveUpdate(); });
    rooms.leaveRoom(io, socket);
    await updated;
    assert.equal(moderation.getCommandActorRole('700', '42'), 'normal');
    assert.equal(update.mock.calls[0].arguments[0], 'trusted-room');
    assert.equal(update.mock.calls[0].arguments[2].can_publish, false);
});

test('delayed ban removal is discarded if the ban expired or was revoked', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const state = require('../socket/rooms/room-policy.state');
    state.rememberRemoval('trusted-room', '42', '700');
    t.mock.method(laravel, 'readRoomPolicy', async () => response());
    const remove = t.mock.method(livekit, 'removeActiveParticipant', async () => ({}));
    const stop = policy.startPolicyRefresh({ sockets: { sockets: new Map() } });
    t.after(stop);
    t.mock.timers.tick(60000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(remove.mock.callCount(), 0);
    assert.equal(state.getPendingRemovals().some((entry) => entry.identity === '42'), false);
});

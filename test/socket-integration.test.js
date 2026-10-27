const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');
const laravel = require('../services/laravel.service');
const livekit = require('../services/livekit.service');
const roomValidation = require('../socket/rooms/room.validation');
const internalHttp = require('../services/internal-http.service');
const rooms = require('../socket/rooms/room.service');
const roomState = require('../socket/rooms/room.state');
const moderation = require('../socket/moderation/moderation.service');
const state = require('../socket/moderation/moderation.state');
const { verifyToken } = require('../socket/auth/socket.auth');

const originalAuthorize = laravel.authorizeRoomJoin;
const originalNotifyRoomPresence = laravel.notifyRoomPresence;
const originalSave = laravel.saveModerationCommand;
const originalStartAudit = laravel.startModerationAudit;
const originalCompleteAudit = laravel.completeModerationAudit;
const originalRemoveLiveKitParticipant = livekit.removeActiveParticipant;
const originalFetch = global.fetch;
const environment = { ...process.env };

test.beforeEach(() => {
    laravel.notifyRoomPresence = async () => true;
    laravel.startModerationAudit = async (event) => ({ requestId: event.requestId, status: 'started' });
    laravel.completeModerationAudit = async (event) => ({ requestId: event.requestId, status: 'completed' });
    livekit.removeActiveParticipant = async () => ({ removed: false });
});
test.afterEach(() => {
    laravel.authorizeRoomJoin = originalAuthorize;
    laravel.notifyRoomPresence = originalNotifyRoomPresence;
    laravel.saveModerationCommand = originalSave;
    laravel.startModerationAudit = originalStartAudit;
    laravel.completeModerationAudit = originalCompleteAudit;
    livekit.removeActiveParticipant = originalRemoveLiveKitParticipant;
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
        liveKitRoomName: roomId ? 'livekit-' + roomId : null,
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
        room: { id: roomId, ownerId: '1', liveKitRoomName: 'livekit-' + roomId, messagesLocked: locked },
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

test('audit adapter retries with the same UUID and records both phases', async () => {
    configureAdapter();
    const requests = [];
    global.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        requests.push({ body, authorization: options.headers.Authorization });
        if (requests.length === 1) {
            const error = new Error('Response lost after audit write');
            error.name = 'AbortError';
            throw error;
        }
        const responseBody = body.phase === 'started'
            ? { requestId: body.requestId, status: 'started' }
            : {
                requestId: body.requestId,
                status: 'completed',
                result: body.result
            };
        return { ok: true, status: 200, text: async () => JSON.stringify(responseBody) };
    };
    const event = {
        requestId: crypto.randomUUID(),
        roomId: '10',
        action: 'removeUser',
        actorUserId: '1',
        actorRole: 'owner',
        targetUserId: '42',
        reason: 'Policy violation',
        occurredAt: new Date().toISOString()
    };
    const started = await originalStartAudit(event);
    const completed = await originalCompleteAudit(event, {
        action: event.action,
        success: true,
        code: 'OK',
        message: 'Action completed.',
        roomId: event.roomId,
        targetUserId: event.targetUserId,
        requestId: event.requestId,
        occurredAt: event.occurredAt,
        outcome: 'success'
    });

    assert.equal(started.status, 'started');
    assert.equal(completed.status, 'completed');
    assert.deepEqual(requests[0].body, requests[1].body);
    assert.equal(requests[0].authorization, 'Bearer ' + process.env.SOCKET_INTERNAL_SERVICE_TOKEN);
    assert.equal(requests[2].body.phase, 'completed');
    assert.equal(requests[2].body.requestId, event.requestId);
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

test('audit uses authenticated actor data and the same request ID as a persisted command', async () => {
    const io = createIo();
    const room = 'test-audit-identity';
    const owner = createSocket(io, 'audit-owner', '1', room);
    const member = createSocket(io, 'audit-member', '42', room);
    state.setPersistentRole(room, '1', 'owner');
    const requestId = crypto.randomUUID();
    let auditStart;
    let auditResult;
    let commandRequestId;
    laravel.startModerationAudit = async (event) => {
        auditStart = event;
        return { requestId: event.requestId, status: 'started' };
    };
    laravel.completeModerationAudit = async (event, result) => {
        auditResult = { event, result };
        return { requestId: event.requestId, status: 'completed' };
    };
    laravel.saveModerationCommand = async (_room, command) => {
        commandRequestId = command.requestId;
        return success(command, { banned: true });
    };

    await moderation.handleModeration(io, owner, 'banUser', {
        roomId: room,
        targetUserId: '42',
        reason: 'policy violation',
        requestId,
        actorUserId: 'forged-user',
        actorRole: 'normal'
    });

    assert.equal(auditStart.actorUserId, '1');
    assert.equal(auditStart.actorRole, 'owner');
    assert.equal(auditStart.targetUserId, '42');
    assert.equal(auditStart.requestId, requestId);
    assert.equal(auditStart.occurredAt, auditResult.event.occurredAt);
    assert.equal(commandRequestId, requestId);
    assert.equal(auditResult.result.outcome, 'success');
    assert.deepEqual(io.broadcasts.find((item) => item.event === 'userBanned').data, {
        roomId: room, userId: '42'
    });
    assert.equal(member.roomId, null);
    assert.equal(owner.events.at(-1).data.requestId, requestId);
    assert.equal(typeof state.getBan, 'undefined');
});

test('failed audit startup prevents moderation state changes and success events', async () => {
    const io = createIo();
    const room = 'test-audit-unavailable';
    const owner = createSocket(io, 'audit-failure-owner', '1', room);
    state.setPersistentRole(room, '1', 'owner');
    let savedCommands = 0;
    laravel.startModerationAudit = async () => {
        throw new laravel.LaravelServiceError('LARAVEL_UNAVAILABLE', 'Audit unavailable.', 503);
    };
    laravel.saveModerationCommand = async () => { savedCommands++; };

    await moderation.handleModeration(io, owner, 'banUser', { roomId: room, targetUserId: '42' });

    assert.equal(savedCommands, 0);
    assert.equal(io.broadcasts.some((item) => item.event === 'userBanned'), false);
    assert.equal(owner.events.at(-1).event, 'moderationResult');
    assert.equal(owner.events.at(-1).data.success, false);
    assert.equal(owner.events.at(-1).data.code, 'LARAVEL_UNAVAILABLE');
});

test('persisted actions use Laravel command auditing when the separate audit route is absent', async () => {
    const io = createIo();
    const room = 'test-command-audit-fallback';
    const owner = createSocket(io, 'fallback-owner', '1', room);
    const member = createSocket(io, 'fallback-member', '42', room);
    state.setPersistentRole(room, '1', 'owner');
    let command;
    let completionCalls = 0;
    laravel.startModerationAudit = async () => {
        throw new laravel.LaravelServiceError('LARAVEL_ENDPOINT_NOT_FOUND', 'Route not found.', 404);
    };
    laravel.saveModerationCommand = async (_roomId, receivedCommand) => {
        command = receivedCommand;
        return success(receivedCommand, { banned: true });
    };
    laravel.completeModerationAudit = async () => { completionCalls++; };

    await moderation.handleModeration(io, owner, 'banUser', {
        roomId: room,
        targetUserId: '42',
        requestId: crypto.randomUUID()
    });

    assert.equal(command.action, 'ban');
    assert.equal(command.actorUserId, '1');
    assert.equal(command.targetUserId, '42');
    assert.equal(completionCalls, 0);
    assert.equal(io.broadcasts.some((item) => item.event === 'userBanned'), true);
    assert.equal(member.roomId, null);
    assert.equal(owner.events.at(-1).data.success, true);
});

test('transient actions remain fail-closed until Laravel provides their audit contract', async () => {
    const io = createIo();
    const room = 'test-transient-audit-missing';
    const owner = createSocket(io, 'transient-owner', '1', room);
    const member = createSocket(io, 'transient-member', '42', room);
    state.setPersistentRole(room, '1', 'owner');
    let liveKitRemovalCalls = 0;
    livekit.removeActiveParticipant = async () => { liveKitRemovalCalls++; };
    laravel.startModerationAudit = async () => {
        throw new laravel.LaravelServiceError('LARAVEL_ENDPOINT_NOT_FOUND', 'Route not found.', 404);
    };

    await moderation.handleModeration(io, owner, 'removeUser', {
        roomId: room,
        targetUserId: '42'
    });

    assert.equal(liveKitRemovalCalls, 0);
    assert.equal(member.roomId, room);
    assert.equal(member.events.some((event) => event.event === 'kicked'), false);
    assert.equal(owner.events.at(-1).data.code, 'LARAVEL_ENDPOINT_NOT_FOUND');
});

test('a Laravel ban failure never emits userBanned or a successful moderationResult', async () => {
    const io = createIo();
    const room = 'test-ban-rejected';
    const owner = createSocket(io, 'rejected-ban-owner', '1', room);
    const member = createSocket(io, 'rejected-ban-member', '42', room);
    state.setPersistentRole(room, '1', 'owner');
    let auditedResult;
    laravel.saveModerationCommand = async () => {
        throw new laravel.LaravelServiceError('FORBIDDEN', 'Laravel rejected the command.', 403);
    };
    laravel.completeModerationAudit = async (event, result) => {
        auditedResult = result;
        return { requestId: event.requestId, status: 'completed' };
    };

    await moderation.handleModeration(io, owner, 'banUser', { roomId: room, targetUserId: '42' });

    assert.equal(auditedResult.outcome, 'rejected');
    assert.equal(io.broadcasts.some((item) => item.event === 'userBanned'), false);
    assert.equal(member.roomId, room);
    assert.equal(owner.events.at(-1).data.success, false);
    assert.equal(owner.events.at(-1).data.code, 'FORBIDDEN');
});

test('a rejected moderator attempt is audited with server-derived actor and result', async () => {
    const io = createIo();
    const room = 'test-audit-rejection';
    const normalUser = createSocket(io, 'audit-normal', '42', room);
    let start;
    let completion;
    laravel.startModerationAudit = async (event) => {
        start = event;
        return { requestId: event.requestId, status: 'started' };
    };
    laravel.completeModerationAudit = async (event, result) => {
        completion = { event, result };
        return { requestId: event.requestId, status: 'completed' };
    };

    await moderation.handleModeration(io, normalUser, 'removeUser', {
        roomId: room,
        targetUserId: '99',
        actorUserId: 'forged-actor',
        actorRole: 'owner'
    });

    assert.equal(start.actorUserId, '42');
    assert.equal(start.actorRole, 'normal');
    assert.equal(completion.result.outcome, 'rejected');
    assert.equal(completion.result.code, 'FORBIDDEN');
    assert.equal(normalUser.events.at(-1).data.success, false);
});

test('concurrent retries with one requestId share the same moderation attempt', async () => {
    const io = createIo();
    const room = 'test-audit-concurrency';
    const owner = createSocket(io, 'concurrent-owner', '1', room);
    createSocket(io, 'concurrent-member', '42', room);
    state.setPersistentRole(room, '1', 'owner');
    const startGate = deferred();
    let startCalls = 0;
    let commandCalls = 0;
    let completionCalls = 0;
    laravel.startModerationAudit = async (event) => {
        startCalls++;
        await startGate.promise;
        return { requestId: event.requestId, status: 'started' };
    };
    laravel.saveModerationCommand = async (_room, command) => {
        commandCalls++;
        return success(command, { banned: true });
    };
    laravel.completeModerationAudit = async (event) => {
        completionCalls++;
        return { requestId: event.requestId, status: 'completed' };
    };
    const request = {
        roomId: room,
        targetUserId: '42',
        requestId: crypto.randomUUID()
    };

    const first = moderation.handleModeration(io, owner, 'banUser', request);
    const second = moderation.handleModeration(io, owner, 'banUser', request);
    startGate.resolve();
    await Promise.all([first, second]);

    assert.equal(startCalls, 1);
    assert.equal(commandCalls, 1);
    assert.equal(completionCalls, 1);
    assert.equal(io.broadcasts.filter((item) => item.event === 'userBanned').length, 1);
});

test('an unban rejection does not broadcast userUnbanned', async () => {
    const io = createIo();
    const room = 'test-unban-rejected';
    const owner = createSocket(io, 'rejected-unban-owner', '1', room);
    state.setPersistentRole(room, '1', 'owner');
    laravel.saveModerationCommand = async () => {
        throw new laravel.LaravelServiceError('USER_NOT_BANNED', 'No active ban.', 422);
    };

    await moderation.handleModeration(io, owner, 'unbanUser', { roomId: room, targetUserId: '42' });

    assert.equal(io.broadcasts.some((item) => item.event === 'userUnbanned'), false);
    assert.equal(owner.events.at(-1).data.success, false);
    assert.equal(owner.events.at(-1).data.code, 'USER_NOT_BANNED');
});

test('removeUser removes an active LiveKit participant before kicking Socket membership', async () => {
    const io = createIo();
    const room = 'test-livekit-kick';
    const owner = createSocket(io, 'livekit-owner', '1', room);
    const target = createSocket(io, 'livekit-target', '42', room);
    state.setPersistentRole(room, '1', 'owner');
    let participantRemoved = false;
    livekit.removeActiveParticipant = async (roomName, identity) => {
        assert.equal(roomName, 'livekit-' + room);
        assert.equal(identity, '42');
        assert.equal(target.roomId, room);
        participantRemoved = true;
        return { removed: true };
    };

    await moderation.handleModeration(io, owner, 'removeUser', { roomId: room, targetUserId: '42' });

    assert.equal(participantRemoved, true);
    assert.equal(target.roomId, null);
    assert.equal(target.events.find((event) => event.event === 'kicked').data.userId, '42');
    assert.equal(owner.events.at(-1).data.success, true);
});

test('sequential retry completes a pending audit without repeating a local moderation action', async () => {
    const io = createIo();
    const room = 'test-pending-local-audit';
    const owner = createSocket(io, 'pending-audit-owner', '1', room);
    const target = createSocket(io, 'pending-audit-target', '42', room);
    state.setPersistentRole(room, '1', 'owner');
    let participantRemovalCount = 0;
    let completionCount = 0;
    livekit.removeActiveParticipant = async () => {
        participantRemovalCount++;
        return { removed: true };
    };
    laravel.completeModerationAudit = async (event, result) => {
        completionCount++;
        if (completionCount === 1) throw new Error('Laravel audit completion unavailable');
        return {
            requestId: event.requestId,
            status: 'completed',
            result: {
                action: result.action,
                success: result.success,
                code: result.code,
                message: result.message,
                roomId: result.roomId,
                targetUserId: result.targetUserId,
                requestId: result.requestId,
                occurredAt: result.occurredAt
            }
        };
    };
    const request = {
        roomId: room,
        targetUserId: '42',
        requestId: crypto.randomUUID()
    };

    await moderation.handleModeration(io, owner, 'removeUser', request);
    assert.equal(owner.events.at(-1).data.code, 'MODERATION_AUDIT_RESULT_PENDING');
    assert.equal(target.events.filter((event) => event.event === 'kicked').length, 1);
    assert.equal(participantRemovalCount, 1);

    await moderation.handleModeration(io, owner, 'removeUser', request);

    assert.equal(owner.events.at(-1).data.success, true);
    assert.equal(target.events.filter((event) => event.event === 'kicked').length, 1);
    assert.equal(participantRemovalCount, 1);
    assert.equal(completionCount, 2);
});

function sendJson(server, path, body, token) {
    const address = server.address();
    return new Promise((resolve, reject) => {
        const request = http.request({
            host: '127.0.0.1',
            port: address.port,
            path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: 'Bearer ' + token } : {})
            }
        }, (response) => {
            let text = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => { text += chunk; });
            response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
        });
        request.on('error', reject);
        request.end(JSON.stringify(body));
    });
}

test('room update ingress authenticates Laravel and emits only validated public fields', async (t) => {
    assert.deepEqual(roomValidation.validateRoomUpdateFields({ country: null }), {
        valid: true,
        fields: { country: null }
    });
    const token = 'internal-test-token-'.repeat(2);
    process.env.SOCKET_INTERNAL_SERVICE_TOKEN = token;
    process.env.SOCKET_JWT_SECRET = 'jwt-test-secret-value-'.repeat(2);
    const app = express();
    const io = createIo();
    internalHttp.registerInternalHttpRoutes(app, io);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

    const body = {
        fields: {
            title: 'Updated room',
            description: 'Public description',
            image: 'https://cdn.example.test/room.png',
            country: { id: '3', name: 'Saudi Arabia', code: 'SA', imageUrl: null }
        }
    };
    const unauthorized = await sendJson(server, '/internal/socket/v1/rooms/10/updates', body);
    assert.equal(unauthorized.status, 401);

    const accepted = await sendJson(server, '/internal/socket/v1/rooms/10/updates', body, token);
    assert.equal(accepted.status, 200);
    assert.deepEqual(io.broadcasts.at(-1), {
        roomId: '10',
        event: 'roomUpdated',
        data: { roomId: '10', ...body.fields }
    });

    const internalField = await sendJson(server, '/internal/socket/v1/rooms/10/updates', {
        fields: { title: 'Updated room', internalServiceToken: 'must-not-broadcast' }
    }, token);
    assert.equal(internalField.status, 422);
    assert.equal(io.broadcasts.length, 1);
});

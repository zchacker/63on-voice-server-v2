const crypto = require('crypto');
const state = require('./moderation.state');
const validation = require('./moderation.validation');
const roomState = require('../rooms/room.state');
const laravel = require('../../services/laravel.service');
const livekit = require('../../services/livekit.service');

const inFlightRequests = new Map();
// Keep the result when an action finished but Laravel has not confirmed its audit completion yet.
const pendingAuditResults = new Map();
const PERSISTED_ACTIONS = {
    banUser: 'ban',
    unbanUser: 'unban',
    promoteFixedModerator: 'promote_fixed',
    demoteFixedModerator: 'demote_fixed',
    muteMic: 'mute_mic',
    unmuteMic: 'unmute_mic',
    lockMessages: 'lock_messages',
    unlockMessages: 'unlock_messages'
};

function buildModerationResult(action, payload, context, result) {
    const output = {
        action,
        success: result.success,
        code: result.code || (result.success ? 'OK' : 'MODERATION_ACTION_FAILED'),
        message: result.message,
        roomId: payload?.roomId || null,
        targetUserId: payload?.targetUserId || null,
        requestId: context.requestId,
        occurredAt: context.occurredAt
    };
    if (result.role !== undefined) output.role = result.role;
    if (result.state) output.state = result.state;
    return output;
}

function emitResult(socket, action, payload, result, context) {
    const output = buildModerationResult(action, payload, context, result);
    if (context) context.result = output;
    else socket.emit('moderationResult', output);
}

function fail(socket, action, payload, result, context) {
    emitResult(socket, action, payload, {
        success: false,
        code: result.code,
        message: result.message
    }, context);
}

function activeSockets(io, roomId, userId) {
    return Array.from(io.sockets.sockets.values())
        .filter((candidate) => candidate.roomId === roomId && candidate.user?.userId === userId);
}

function publishUsers(io, roomId) {
    io.to(roomId).emit('userList', roomState.getRoomUsers(roomId));
}

function publishMics(io, roomId) {
    io.to(roomId).emit('micUpdate', { ...(roomState.getMicSpots(roomId) || {}) });
}

function auditOutcome(result) {
    if (result.success) return 'success';
    if (['FORBIDDEN', 'NOT_IN_ROOM', 'AUTHENTICATION_REQUIRED', 'SELF_TARGET',
        'PROTECTED_TARGET', 'INVALID_ROOM_ID', 'INVALID_TARGET_USER_ID', 'TARGET_NOT_IN_ROOM',
        'TARGET_NOT_AUTHENTICATED', 'FIXED_MODERATOR', 'INVALID_REQUEST_ID', 'UNKNOWN_ACTION'].includes(result.code)) {
        return 'rejected';
    }
    return 'failed';
}

function validateAction(socket, action, payload, context) {
    const result = validation.validateModeration(socket, payload, action);
    if (!result.valid) fail(socket, action, payload, result, context);
    return result;
}

function cancelPendingJoins(io, roomId, targetUserId) {
    for (const candidate of io.sockets.sockets.values()) {
        if (candidate.authenticatedUserId !== targetUserId
            || (candidate.pendingRoomId !== roomId && candidate.pendingCanonicalRoomId !== roomId)) continue;

        candidate.roomJoinAttempt = (candidate.roomJoinAttempt || 0) + 1;
        candidate.pendingRoomId = null;
        candidate.pendingCanonicalRoomId = null;
        candidate.emit('joinRoomRejected', {
            roomId,
            userId: targetUserId,
            code: 'USER_BANNED',
            message: 'You are banned from this room.'
        });
    }
}

function removeTargetFromRoom(io, roomId, targetUserId, notify, reason) {
    const sockets = activeSockets(io, roomId, targetUserId);
    for (const target of sockets) {
        target.leave(roomId);
        target.roomId = null;
        target.requestedRoomId = null;
        target.liveKitRoomName = null;
        target.user = null;
        roomState.removeRoomUser(roomId, target.id);
        laravel.notifyRoomPresence(roomId, {
            event: 'left',
            userId: targetUserId,
            connectionId: target.id,
            eventVersion: roomState.nextPresenceEventVersion(target)
        });
        // Notify only after the Socket membership and local user entry are cleared.
        target.emit(notify, { roomId, userId: targetUserId, reason: reason || null });
    }

    state.removeTemporary(roomId, targetUserId);
    roomState.clearUserMic(roomId, targetUserId);
    publishUsers(io, roomId);
    publishMics(io, roomId);
    return sockets.length;
}

async function persistAction(socket, action, payload) {
    const commandAction = PERSISTED_ACTIONS[action];
    if (!commandAction) return { valid: true, state: null };

    const roomId = payload.roomId;
    const actorUserId = socket.authenticatedUserId;
    const command = {
        requestId: payload.requestId,
        action: commandAction,
        actorUserId,
        actorRole: state.getCommandActorRole(roomId, actorUserId)
    };
    if (payload.targetUserId) command.targetUserId = payload.targetUserId;
    if (typeof payload.reason === 'string') command.reason = payload.reason.slice(0, 1000);

    const roomIdentifier = roomId;
    let response;
    try {
        response = await laravel.saveModerationCommand(roomIdentifier, command);
    } catch (error) {
        const configurationError = error.code?.startsWith('SOCKET_CONFIGURATION');
        const uncertain = !configurationError
            && (['LARAVEL_TIMEOUT', 'LARAVEL_UNAVAILABLE', 'INVALID_LARAVEL_RESPONSE'].includes(error.code)
                || error.status >= 500);
        if (uncertain) state.rememberPendingCommand(roomId, { roomIdentifier, command });
        return { valid: false, uncertain, ...laravel.getPublicError(error) };
    }

    const result = validation.validatePersistedCommandResult(commandAction, response, command.requestId);
    if (!result.valid && response.success === true) {
        state.rememberPendingCommand(roomId, { roomIdentifier, command });
        result.uncertain = true;
    }
    return result;
}

function rejectPersistence(io, socket, action, payload, result, context) {
    if (result.uncertain) {
        // انقطاع الرد لا يعني تراجع معاملة Laravel. نفرغ العضوية حتى يُعاد التحقق من الحالة الفعلية.
        const users = new Set(Array.from(io.sockets.sockets.values())
            .filter((candidate) => candidate.roomId === payload.roomId)
            .map((candidate) => candidate.user.userId));
        for (const userId of users) {
            removeTargetFromRoom(io, payload.roomId, userId, 'kicked', 'Room state requires reauthorization.');
        }
    }
    return fail(socket, action, payload, result, context);
}

function applyPersistedState(roomId, targetUserId, persistedState) {
    if (targetUserId && typeof persistedState.role === 'string') {
        state.setPersistentRole(roomId, targetUserId, persistedState.role);
    }
    if (targetUserId && typeof persistedState.micMuted === 'boolean') {
        if (persistedState.micMuted) state.muteUser(roomId, targetUserId);
        else state.unmuteUser(roomId, targetUserId);
    }
    if (typeof persistedState.messagesLocked === 'boolean') {
        if (persistedState.messagesLocked) state.lockMessages(roomId);
        else state.unlockMessages(roomId);
    }
}

async function moderationAction(io, socket, action, payload = {}, context) {
    const checked = validateAction(socket, action, payload, context);
    if (!checked.valid) return;

    const { roomId, targetUserId } = payload;
    // Keep the verified room target even if the actor disconnects during Laravel's request.
    const liveKitRoomName = socket.liveKitRoomName;
    const reason = typeof payload.reason === 'string' ? payload.reason.slice(0, 1000) : null;
    const persisted = PERSISTED_ACTIONS[action]
        ? await persistAction(socket, action, payload)
        : { valid: true, state: null };
    if (!persisted.valid) return rejectPersistence(io, socket, action, payload, persisted, context);
    if (persisted.state) {
        applyPersistedState(roomId, targetUserId, persisted.state);
    }

    let role;
    switch (action) {
        case 'banUser':
            let livekitError;
            try {
                await livekit.removeActiveParticipant(liveKitRoomName, targetUserId);
            } catch (error) {
                livekitError = error;
            }
            cancelPendingJoins(io, roomId, targetUserId);
            removeTargetFromRoom(io, roomId, targetUserId, 'kicked', reason);
            io.to(roomId).emit('userBanned', { roomId, userId: targetUserId });
            if (livekitError) {
                return fail(socket, action, payload, {
                    code: livekitError.code || 'LIVEKIT_REMOVAL_FAILED',
                    message: 'The ban was saved, but LiveKit could not remove the active participant.'
                }, context);
            }
            break;
        case 'unbanUser':
            io.to(roomId).emit('userUnbanned', { roomId, userId: targetUserId });
            break;
        case 'removeUser':
            try {
                await livekit.removeActiveParticipant(liveKitRoomName, targetUserId);
            } catch (error) {
                return fail(socket, action, payload, {
                    code: error.code || 'LIVEKIT_REMOVAL_FAILED',
                    message: 'LiveKit could not remove the active participant.'
                }, context);
            }
            removeTargetFromRoom(io, roomId, targetUserId, 'kicked', reason);
            io.to(roomId).emit('userRemoved', { roomId, userId: targetUserId });
            break;
        case 'promoteTemporaryModerator':
            if (!activeSockets(io, roomId, targetUserId).length) {
                return fail(socket, action, payload, {
                    code: 'TARGET_NOT_IN_ROOM',
                    message: 'The target must currently be in the room for temporary promotion.'
                }, context);
            }
            if (!activeSockets(io, roomId, targetUserId)
                .every((target) => target.authenticatedUserId === targetUserId)) {
                return fail(socket, action, payload, {
                    code: 'TARGET_NOT_AUTHENTICATED',
                    message: 'The target must have a valid authenticated session.'
                }, context);
            }
            if (!state.promoteTemporary(roomId, targetUserId)) {
                return fail(socket, action, payload, {
                    code: 'FIXED_MODERATOR',
                    message: 'A room owner or fixed moderator cannot be changed to temporary.'
                }, context);
            }
            role = 'temporary';
            break;
        case 'promoteFixedModerator':
            role = 'fixed';
            break;
        case 'demoteFixedModerator':
            state.removeTemporary(roomId, targetUserId);
            role = 'normal';
            break;
        case 'muteMic':
            roomState.clearUserMic(roomId, targetUserId);
            for (const target of activeSockets(io, roomId, targetUserId)) {
                target.emit('micMuted', { roomId, userId: targetUserId });
            }
            publishMics(io, roomId);
            io.to(roomId).emit('micModerationUpdated', {
                roomId,
                userId: targetUserId,
                muted: true
            });
            break;
        case 'unmuteMic':
            for (const target of activeSockets(io, roomId, targetUserId)) {
                target.emit('micUnmuted', { roomId, userId: targetUserId });
            }
            io.to(roomId).emit('micModerationUpdated', {
                roomId,
                userId: targetUserId,
                muted: false
            });
            break;
        default:
            return fail(socket, action, payload, {
                code: 'UNKNOWN_ACTION',
                message: 'Unknown moderation action.'
            }, context);
    }

    if (role) {
        for (const target of activeSockets(io, roomId, targetUserId)) {
            target.emit('roleUpdated', { roomId, userId: targetUserId, role });
        }
        io.to(roomId).emit('moderatorUpdated', { roomId, userId: targetUserId, role });
    }

    emitResult(socket, action, payload, {
        success: true,
        message: 'Action completed.',
        role,
        state: persisted.state || undefined
    }, context);
}

async function lockMessages(io, socket, payload = {}, locked, context) {
    const action = locked ? 'lockMessages' : 'unlockMessages';
    const checked = validation.validateModerator(socket, payload.roomId);
    if (!checked.valid) return fail(socket, action, payload, checked, context);

    // نثبت هوية المنفذ قبل انتظار الشبكة؛ قد يغادر الاتصال بينما يحفظ Laravel الأمر.
    const actorUserId = socket.authenticatedUserId;
    const persisted = await persistAction(socket, action, payload);
    if (!persisted.valid) return rejectPersistence(io, socket, action, payload, persisted, context);
    if (persisted.state.messagesLocked !== locked) {
        return fail(socket, action, payload, {
            code: 'LARAVEL_STATE_MISMATCH',
            message: 'Laravel did not confirm the requested message lock state.'
        }, context);
    }
    applyPersistedState(payload.roomId, null, persisted.state);

    const eventPayload = {
        roomId: payload.roomId,
        locked,
        changedBy: actorUserId,
        normalUsersOnly: locked
    };
    io.to(payload.roomId).emit('messageLockUpdated', eventPayload);
    emitResult(socket, action, payload, {
        success: true,
        message: 'Action completed.',
        state: persisted.state
    }, context);
}

function normalizeModerationPayload(socket, payload) {
    const normalizedPayload = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? { ...payload }
        : {};
    // actor والrole لا يأتيان من العميل؛ نعتمد هوية JWT والرتبة التي عُيّنت بعد Laravel authorization.
    delete normalizedPayload.actorUserId;
    delete normalizedPayload.actorRole;
    // نقبل ID المرسل أو الاسم الذي استُخدم عند الانضمام، ونطبق الإشراف على الغرفة الموحدة فقط.
    const suppliedRoomId = String(normalizedPayload.roomId ?? '');
    if (socket.roomId && [socket.roomId, socket.requestedRoomId].includes(suppliedRoomId))
        normalizedPayload.roomId = socket.roomId;
    return normalizedPayload;
}

function isUuid(value) {
    return typeof value === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function createModerationContext(socket, action, payload) {
    const suppliedRequestId = payload.requestId;
    const requestIdIsValid = suppliedRequestId === undefined || isUuid(suppliedRequestId);
    const requestId = requestIdIsValid && typeof suppliedRequestId === 'string'
        ? suppliedRequestId
        : crypto.randomUUID();
    payload.requestId = requestId;
    const roomId = typeof payload.roomId === 'string' && payload.roomId.trim()
        ? payload.roomId.trim()
        : socket.roomId || null;
    const actorUserId = typeof socket.authenticatedUserId === 'string'
        ? socket.authenticatedUserId
        : null;
    const context = {
        requestId,
        occurredAt: new Date().toISOString(),
        actorUserId,
        actorRole: validation.getActorRole(socket, roomId || ''),
        result: null
    };
    const auditEvent = {
        requestId,
        roomId,
        action,
        actorUserId,
        actorRole: context.actorRole,
        targetUserId: typeof payload.targetUserId === 'string'
            ? payload.targetUserId.slice(0, 64)
            : null,
        reason: typeof payload.reason === 'string'
            ? payload.reason.slice(0, 1000)
            : null,
        occurredAt: context.occurredAt
    };
    const fingerprint = JSON.stringify([
        roomId, action, actorUserId, context.actorRole, auditEvent.targetUserId, auditEvent.reason
    ]);
    return { requestId, requestIdIsValid, context, auditEvent, fingerprint };
}

async function executeModerationAction(io, socket, action, payload, context, requestIdIsValid, roomId) {
    const execute = async () => {
        try {
            if (!requestIdIsValid) {
                return fail(socket, action, payload, {
                    code: 'INVALID_REQUEST_ID',
                    message: 'requestId must be a UUID when provided.'
                }, context);
            }
            if (action === 'lockMessages')
                return await lockMessages(io, socket, payload, true, context);
            if (action === 'unlockMessages')
                return await lockMessages(io, socket, payload, false, context);
            return await moderationAction(io, socket, action, payload, context);
        } catch {
            return fail(socket, action, payload, {
                code: 'MODERATION_ACTION_FAILED',
                message: 'The moderation action could not be completed.'
            }, context);
        }
    };

    if (typeof roomId === 'string') return roomState.runRoomOperation(roomId, execute);
    return execute();
}

async function executeAndBuildResult(io, socket, action, payload, requestIdIsValid, context, roomId) {
    await executeModerationAction(io, socket, action, payload, context, requestIdIsValid, roomId);
    return context.result || buildModerationResult(action, payload, context, {
        success: false,
        code: 'MODERATION_ACTION_FAILED',
        message: 'The moderation action could not be completed.'
    });
}

async function runAuditedModeration(
    io, socket, action, payload, requestIdIsValid, context, auditEvent, fingerprint
) {
    let auditStart;
    try {
        auditStart = await laravel.startModerationAudit(auditEvent);
    } catch (error) {
        // Laravel's current command endpoint already stores outcomes for the eight durable actions.
        if (PERSISTED_ACTIONS[action] && error.code === 'LARAVEL_ENDPOINT_NOT_FOUND') {
            const result = await executeAndBuildResult(
                io, socket, action, payload, requestIdIsValid, context, auditEvent.roomId
            );
            socket.emit('moderationResult', result);
            return result;
        }

        const output = buildModerationResult(action, payload, context, {
            success: false,
            ...laravel.getPublicError(error)
        });
        socket.emit('moderationResult', output);
        return output;
    }

    if (auditStart.status === 'completed' && auditStart.result) {
        socket.emit('moderationResult', auditStart.result);
        return auditStart.result;
    }
    if (auditStart.status !== 'started') {
        const output = buildModerationResult(action, payload, context, {
            success: false,
            code: 'INVALID_LARAVEL_RESPONSE',
            message: 'Laravel did not confirm the moderation audit attempt.'
        });
        socket.emit('moderationResult', output);
        return output;
    }

    const result = await executeAndBuildResult(
        io, socket, action, payload, requestIdIsValid, context, auditEvent.roomId
    );
    try {
        await laravel.completeModerationAudit(auditEvent, {
            ...result,
            outcome: auditOutcome(result)
        });
    } catch {
        pendingAuditResults.set(context.requestId, {
            fingerprint,
            auditEvent,
            result: { ...result }
        });
        result.success = false;
        result.code = 'MODERATION_AUDIT_RESULT_PENDING';
        result.message = 'The moderation result could not be confirmed by the audit service.';
    }
    socket.emit('moderationResult', result);
    return result;
}

async function retryPendingAudit(socket, pending) {
    try {
        const response = await laravel.completeModerationAudit(pending.auditEvent, {
            ...pending.result,
            outcome: auditOutcome(pending.result)
        });
        const result = response.result || pending.result;
        pendingAuditResults.delete(pending.auditEvent.requestId);
        socket.emit('moderationResult', result);
        return result;
    } catch {
        const result = {
            ...pending.result,
            success: false,
            code: 'MODERATION_AUDIT_RESULT_PENDING',
            message: 'The moderation result could not be confirmed by the audit service.'
        };
        socket.emit('moderationResult', result);
        return result;
    }
}

async function handleModeration(io, socket, action, payload) {
    const normalizedPayload = normalizeModerationPayload(socket, payload);
    const { requestId, requestIdIsValid, context, auditEvent, fingerprint } =
        createModerationContext(socket, action, normalizedPayload);
    const inFlight = inFlightRequests.get(requestId);
    if (inFlight && inFlight.fingerprint === fingerprint) {
        const previousResult = await inFlight.promise;
        socket.emit('moderationResult', previousResult);
        return previousResult;
    }
    const pending = pendingAuditResults.get(requestId);
    if (pending) {
        if (pending.fingerprint !== fingerprint) {
            const result = buildModerationResult(action, normalizedPayload, context, {
                success: false,
                code: 'IDEMPOTENCY_KEY_REUSED',
                message: 'This requestId was already used for a different moderation action.'
            });
            socket.emit('moderationResult', result);
            return result;
        }
        return retryPendingAudit(socket, pending);
    }

    const operation = runAuditedModeration(
        io, socket, action, normalizedPayload, requestIdIsValid, context, auditEvent, fingerprint
    );
    inFlightRequests.set(requestId, { fingerprint, promise: operation });
    try {
        return await operation;
    } finally {
        if (inFlightRequests.get(requestId)?.promise === operation) inFlightRequests.delete(requestId);
    }
}

async function reconcileRoom(roomId) {
    const pending = state.getPendingCommand(roomId);
    if (!pending) return false;

    // لا نفتح الغرفة بعد نتيجة مجهولة حتى نسترجع نتيجة UUID الأصلي من Laravel.
    const { command, roomIdentifier } = pending;
    let response;
    try {
        response = await laravel.saveModerationCommand(roomIdentifier, command);
    } catch (error) {
        // يعيد Laravel النتيجة المحفوظة قبل فحص الصلاحيات؛ الرفض القطعي هنا يعني أن UUID لم يُحفظ.
        if ([403, 404, 422].includes(error.status)) {
            state.clearPendingCommand(roomId);
            return true;
        }
        throw error;
    }
    if (response.success === false) {
        state.clearPendingCommand(roomId);
        return true;
    }
    const result = validation.validatePersistedCommandResult(command.action, response, command.requestId);
    if (!result.valid) {
        throw new laravel.LaravelServiceError(
            'ROOM_STATE_UNCERTAIN', 'Room moderation state could not be reconciled.', 503
        );
    }
    applyPersistedState(roomId, command.targetUserId, result.state);
    state.clearPendingCommand(roomId);
    return true;
}

function syncFromAuthorization(roomId, userId, authorization) {
    state.setPersistentRole(roomId, userId, authorization.role);

    if (authorization.moderation.micMuted) state.muteUser(roomId, userId);
    else state.unmuteUser(roomId, userId);

    if (authorization.room.messagesLocked) state.lockMessages(roomId);
    else state.unlockMessages(roomId);
}

function handleJoin(socket, roomId) {
    const userId = socket.user.userId;
    const role = validation.getActorRole(socket, roomId);
    socket.emit('roleUpdated', { roomId, userId, role });
}

function handleLeave(io, socket, roomId, userId) {
    if (roomId && userId && !activeSockets(io, roomId, userId).length)
        state.removeTemporary(roomId, userId);
}

function isMuted(roomId, userId) {
    return state.isUserMuted(roomId, userId);
}

function canSendMessage(socket) {
    const role = validation.getActorRole(socket, socket.roomId);
    return !state.areMessagesLocked(socket.roomId) || role !== 'normal';
}

function isMessagesLocked(roomId) {
    return state.areMessagesLocked(roomId);
}

module.exports = {
    handleModeration,
    handleJoin,
    handleLeave,
    syncFromAuthorization,
    reconcileRoom,
    isMuted,
    canSendMessage,
    isMessagesLocked
};

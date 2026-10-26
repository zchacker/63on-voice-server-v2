const API_PREFIX = '/api/internal/socket/v1';
const DEFAULT_TIMEOUT_MS = 5000;
const MIN_SECRET_LENGTH = 32;

class LaravelServiceError extends Error {
    constructor(code, message, status) {
        super(message);
        this.name = 'LaravelServiceError';
        this.code = code;
        this.status = status;
    }
}

function getConfiguration() {
    const baseUrlValue = process.env.SOCKET_LARAVEL_API_BASE_URL;
    const jwtSecret = process.env.SOCKET_JWT_SECRET;
    const serviceToken = process.env.SOCKET_INTERNAL_SERVICE_TOKEN;
    const missing = [];

    if (!baseUrlValue) missing.push('SOCKET_LARAVEL_API_BASE_URL');
    if (!jwtSecret) missing.push('SOCKET_JWT_SECRET');
    if (!serviceToken) missing.push('SOCKET_INTERNAL_SERVICE_TOKEN');
    if (missing.length) {
        throw new LaravelServiceError(
            'SOCKET_CONFIGURATION_MISSING',
            'Missing required environment variables: ' + missing.join(', '),
            503
        );
    }
    if (jwtSecret.length < MIN_SECRET_LENGTH) {
        throw new LaravelServiceError(
            'SOCKET_CONFIGURATION_INVALID',
            'SOCKET_JWT_SECRET must contain at least 32 characters.',
            503
        );
    }
    if (serviceToken.length < MIN_SECRET_LENGTH) {
        throw new LaravelServiceError(
            'SOCKET_CONFIGURATION_INVALID',
            'SOCKET_INTERNAL_SERVICE_TOKEN must contain at least 32 characters.',
            503
        );
    }
    if (jwtSecret === serviceToken) {
        throw new LaravelServiceError(
            'SOCKET_CONFIGURATION_INVALID',
            'SOCKET_JWT_SECRET and SOCKET_INTERNAL_SERVICE_TOKEN must be different values.',
            503
        );
    }

    let baseUrl;
    try {
        baseUrl = new URL(baseUrlValue);
    } catch {
        throw new LaravelServiceError(
            'SOCKET_CONFIGURATION_INVALID',
            'SOCKET_LARAVEL_API_BASE_URL must be an absolute HTTP(S) origin.',
            503
        );
    }

    if (!['http:', 'https:'].includes(baseUrl.protocol)
        || baseUrl.pathname !== '/'
        || baseUrl.search
        || baseUrl.hash) {
        throw new LaravelServiceError(
            'SOCKET_CONFIGURATION_INVALID',
            'SOCKET_LARAVEL_API_BASE_URL must be an origin without a path, query, or fragment.',
            503
        );
    }

    const timeoutValue = process.env.SOCKET_LARAVEL_REQUEST_TIMEOUT_MS;
    const timeoutMs = timeoutValue ? Number(timeoutValue) : DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) {
        throw new LaravelServiceError(
            'SOCKET_CONFIGURATION_INVALID',
            'SOCKET_LARAVEL_REQUEST_TIMEOUT_MS must be an integer from 100 to 30000.',
            503
        );
    }

    return {
        baseUrl: baseUrl.origin,
        serviceToken,
        timeoutMs
    };
}

function responseErrorCode(payload, status) {
    if (typeof payload?.code === 'string' && /^[A-Z0-9_]+$/.test(payload.code))
        return payload.code;
    if (status === 401) return 'LARAVEL_SERVICE_AUTH_FAILED';
    if (status === 404) return 'LARAVEL_ENDPOINT_NOT_FOUND';
    return 'LARAVEL_REQUEST_REJECTED';
}

function responseErrorMessage(payload) {
    if (typeof payload?.message === 'string' && payload.message.trim())
        return payload.message.slice(0, 500);
    return 'Laravel rejected the internal Socket request.';
}

async function postInternal(path, body) {
    const config = getConfiguration();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    timeout.unref?.();

    let response;
    let responseText;
    try {
        response = await fetch(new URL(API_PREFIX + path, config.baseUrl), {
            method: 'POST',
            redirect: 'error',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + config.serviceToken
            },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        responseText = await response.text();
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new LaravelServiceError(
                'LARAVEL_TIMEOUT',
                'Laravel did not respond before the Socket service timeout.',
                504
            );
        }
        throw new LaravelServiceError(
            'LARAVEL_UNAVAILABLE',
            'The Socket service could not reach Laravel.',
            503
        );
    } finally {
        clearTimeout(timeout);
    }

    let payload;
    try {
        payload = JSON.parse(responseText);
    } catch {
        throw new LaravelServiceError(
            'INVALID_LARAVEL_RESPONSE',
            'Laravel returned a non-JSON response to an internal Socket request.',
            response.status
        );
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new LaravelServiceError(
            'INVALID_LARAVEL_RESPONSE',
            'Laravel returned an invalid response to an internal Socket request.',
            response.status
        );
    }

    if (!response.ok) {
        throw new LaravelServiceError(
            responseErrorCode(payload, response.status),
            responseErrorMessage(payload),
            response.status
        );
    }

    return payload;
}

async function authorizeRoomJoin(roomId, userId, connectionId) {
    const encodedRoomId = encodeURIComponent(roomId);
    return postInternal(
        '/rooms/' + encodedRoomId + '/authorize-join',
        { userId, connectionId }
    );
}

async function saveModerationCommand(roomId, command) {
    const encodedRoomId = encodeURIComponent(roomId);
    const path = '/rooms/' + encodedRoomId + '/moderation/commands';
    let response;
    // نحافظ على UUID والحمولة نفسيهما: Laravel يعيد النتيجة المحفوظة بدل تنفيذ الأمر مرتين.
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            response = await postInternal(path, command);
            break;
        } catch (error) {
            const configurationError = error.code?.startsWith('SOCKET_CONFIGURATION');
            const retryable = !configurationError
                && (['LARAVEL_TIMEOUT', 'LARAVEL_UNAVAILABLE'].includes(error.code) || error.status >= 500);
            if (!retryable || attempt === 2) throw error;
        }
    }

    if (response.requestId !== command.requestId) {
        throw new LaravelServiceError(
            'INVALID_LARAVEL_RESPONSE',
            'Laravel returned a different moderation requestId.',
            502
        );
    }
    if (typeof response.success !== 'boolean') {
        throw new LaravelServiceError(
            'INVALID_LARAVEL_RESPONSE',
            'Laravel moderation response must include a success boolean.',
            502
        );
    }
    if (response.success && (!response.state || typeof response.state !== 'object'
        || Array.isArray(response.state))) {
        throw new LaravelServiceError(
            'INVALID_LARAVEL_RESPONSE',
            'Successful Laravel moderation responses must include the current state.',
            502
        );
    }

    return response;
}

async function postModerationAudit(event) {
    const path = '/moderation/audit-events';
    let response;
    // كلا المرحلتين تعيدان استخدام UUID والحقول نفسها عند إعادة المحاولة.
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            response = await postInternal(path, event);
            break;
        } catch (error) {
            const configurationError = error.code?.startsWith('SOCKET_CONFIGURATION');
            const retryable = !configurationError
                && (['LARAVEL_TIMEOUT', 'LARAVEL_UNAVAILABLE'].includes(error.code) || error.status >= 500);
            if (!retryable || attempt === 2) throw error;
        }
    }

    const acceptedStatuses = event.phase === 'started' ? ['started', 'completed'] : ['completed'];
    if (response.requestId !== event.requestId || !acceptedStatuses.includes(response.status)) {
        throw new LaravelServiceError(
            'INVALID_LARAVEL_RESPONSE',
            'Laravel returned an invalid moderation audit response.',
            502
        );
    }
    if (response.status === 'completed'
        && (!response.result || typeof response.result !== 'object'
            || Array.isArray(response.result)
            || response.result.requestId !== event.requestId
            || typeof response.result.success !== 'boolean'
            || response.result.action !== event.action)) {
        throw new LaravelServiceError(
            'INVALID_LARAVEL_RESPONSE',
            'Laravel returned an invalid completed moderation audit result.',
            502
        );
    }
    return response;
}

function startModerationAudit(event) {
    return postModerationAudit({ ...event, phase: 'started' });
}

function completeModerationAudit(event, result) {
    return postModerationAudit({
        ...event,
        phase: 'completed',
        outcome: result.success ? 'success' : result.outcome,
        code: result.code,
        result: {
            action: result.action,
            success: result.success,
            code: result.code,
            message: result.message,
            roomId: result.roomId,
            targetUserId: result.targetUserId,
            role: result.role,
            state: result.state,
            requestId: result.requestId,
            occurredAt: result.occurredAt
        }
    });
}

function getPublicError(error) {
    if (error instanceof LaravelServiceError) {
        return { code: error.code, message: error.message };
    }
    return {
        code: 'LARAVEL_UNAVAILABLE',
        message: 'The Laravel authorization service is unavailable.'
    };
}

module.exports = {
    authorizeRoomJoin,
    saveModerationCommand,
    startModerationAudit,
    completeModerationAudit,
    getPublicError,
    LaravelServiceError
};

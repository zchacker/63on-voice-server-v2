let cachedConfiguration;
let cachedClient;

function getConfiguration() {
    const hostValue = process.env.LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const secret = process.env.LIVEKIT_API_SECRET;
    if (!hostValue || !apiKey || !secret) {
        const error = new Error('LiveKit server credentials are not configured.');
        error.code = 'LIVEKIT_CONFIGURATION_MISSING';
        throw error;
    }

    let host;
    try {
        host = new URL(hostValue);
    } catch {
        const error = new Error('LIVEKIT_URL must be an absolute HTTPS or WSS URL.');
        error.code = 'LIVEKIT_CONFIGURATION_INVALID';
        throw error;
    }
    if (!['https:', 'wss:'].includes(host.protocol)
        || host.pathname !== '/'
        || host.username || host.password || host.search || host.hash) {
        const error = new Error('LIVEKIT_URL must be an HTTPS or WSS origin without a path or credentials.');
        error.code = 'LIVEKIT_CONFIGURATION_INVALID';
        throw error;
    }

    // The server SDK calls LiveKit's HTTPS management API, even when clients use WSS.
    const origin = new URL(host.origin);
    if (origin.protocol === 'wss:') origin.protocol = 'https:';
    return { host: origin.origin, apiKey, secret };
}

function getClient() {
    const config = getConfiguration();
    if (!cachedClient || !cachedConfiguration
        || cachedConfiguration.host !== config.host
        || cachedConfiguration.apiKey !== config.apiKey
        || cachedConfiguration.secret !== config.secret) {
        const { RoomServiceClient } = require('livekit-server-sdk');
        cachedClient = new RoomServiceClient(config.host, config.apiKey, config.secret);
        cachedConfiguration = config;
    }
    return cachedClient;
}

async function removeActiveParticipant(roomName, identity) {
    if (typeof roomName !== 'string' || !roomName.trim()
        || typeof identity !== 'string' || !identity.trim()) {
        const error = new Error('A LiveKit room name and participant identity are required.');
        error.code = 'LIVEKIT_INVALID_PARTICIPANT';
        throw error;
    }

    const room = roomName.trim();
    const participantIdentity = identity.trim();
    const client = getClient();
    const participants = await client.listParticipants(room);
    if (!participants.some((participant) => participant.identity === participantIdentity)) {
        return { removed: false };
    }

    await client.removeParticipant(room, participantIdentity);
    return { removed: true };
}

async function updateParticipantPermissions(roomName, identity, permissions) {
    if (typeof roomName !== 'string' || !roomName.trim() || typeof identity !== 'string' || !identity.trim())
        throw new Error('A trusted LiveKit room and identity are required.');
    const client = getClient();
    const participants = await client.listParticipants(roomName);
    const participant = participants.find((candidate) => candidate.identity === identity);
    if (!participant) return { updated: false };
    const permission = {
        ...participant.permission,
        canSubscribe: participant.permission?.canSubscribe ?? true,
        canPublish: permissions.can_publish,
        canPublishData: permissions.direct_data_allowed
    };
    if (participant.permission?.canPublish === permission.canPublish
        && participant.permission?.canPublishData === permission.canPublishData) return { updated: false };
    await client.updateParticipant(roomName, identity, { permission });
    return { updated: true };
}

module.exports = { removeActiveParticipant, updateParticipantPermissions };

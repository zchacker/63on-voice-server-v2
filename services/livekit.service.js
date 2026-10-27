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
        const { LiveKitAPI } = require('livekit-server-sdk');
        cachedClient = new LiveKitAPI(config);
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
    const participants = await client.room.listParticipants(room);
    if (!participants.some((participant) => participant.identity === participantIdentity)) {
        return { removed: false };
    }

    await client.room.removeParticipant(room, participantIdentity);
    return { removed: true };
}

module.exports = { removeActiveParticipant };

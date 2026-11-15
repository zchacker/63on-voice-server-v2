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

// Remove one identity directly; an absent participant already satisfies removal.
async function removeActiveParticipant(roomName, identity) {
    if (typeof roomName !== 'string' || !roomName.trim() || typeof identity !== 'string' || !identity.trim()) {
        throw new Error('A trusted LiveKit room and participant identity are required.');
    }

    try {
        await getClient().removeParticipant(roomName, identity);
        return { removed: true };
    } catch (error) {
        if (error.code === 'not_found') return { removed: false };
        throw error;
    }
}

// Read one participant instead of repeatedly downloading the entire room participant list.
async function updateParticipantPermissions(roomName, identity, permissions) {
    if (typeof roomName !== 'string' || !roomName.trim() || typeof identity !== 'string' || !identity.trim())
        throw new Error('A trusted LiveKit room and identity are required.');
    const client = getClient();
    let participant;
    try {
        participant = await client.getParticipant(roomName, identity);
    } catch (error) {
        if (error.code === 'not_found') return { updated: false };
        throw error;
    }

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

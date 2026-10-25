# muteMic

**Direction:** moderator client to server.

## Input

    { "roomId": "room-123", "targetUserId": "user-42" }

Target may be offline. Actor must be an authorized moderator joined to roomId.

## Success outputs

- Actor receives successful moderationResult.
- Active target sockets receive micMuted { roomId, userId }.
- Room receives micModerationUpdated { roomId, userId, muted: true } and micUpdate.
- On a later join, the target receives micMuted again.

The server rejects the muted user's requestMic and audioData events. The frontend should stop its local publishing when it receives micMuted.

## Persistence and trust

Mute is process-local and resets on server restart. Enforcement against a client without JWT is not reliable because that client can claim another userId.

## Source

socket/moderation/moderation.events.js; socket/moderation/moderation.service.js; moderation.state.js; socket/rooms/room.service.js.

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

The server rejects the muted user's requestMic. On micMuted, the frontend must disable/unpublish its LiveKit microphone. Node does not currently force a mute on the LiveKit server. The audioData mute check belongs to an unused legacy relay. See [LiveKit integration](../livekit.md).

## Persistence and trust

Mute is stored by Laravel and restored during room authorization after Node restarts. Node only changes its local mirror, clears the target's mic spots, and broadcasts after Laravel confirms the mute.

## Source

socket/moderation/moderation.events.js; socket/moderation/moderation.service.js; moderation.state.js; socket/rooms/room.service.js.

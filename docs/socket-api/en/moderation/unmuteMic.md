# unmuteMic

**Direction:** moderator client to server.

## Input

    { "roomId": "room-123", "targetUserId": "user-42" }

Target may be offline. Actor must be an authorized moderator joined to roomId.

## Success outputs

- Actor receives successful moderationResult.
- Active target sockets receive micUnmuted { roomId, userId }.
- Room receives micModerationUpdated { roomId, userId, muted: false }.

Unmuting does not automatically reassign a mic spot; the user must request one. Laravel stores the mute state and Node restores it during room authorization.

## Failures

Authorization/payload failures return moderationResult with success=false. Unmuting an already-unmuted user is still treated as successful.

## Source

socket/moderation/moderation.events.js; socket/moderation/moderation.service.js; moderation.state.js.

## LiveKit media

Handle microphone and participant changes through the LiveKit SDK as described in [LiveKit integration](../livekit.md). Socket.IO state changes do not directly change LiveKit server permissions or disconnect its participants.

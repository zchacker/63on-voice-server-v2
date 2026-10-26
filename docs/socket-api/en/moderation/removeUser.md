# removeUser

**Direction:** moderator client to server. This is a kick, not a ban.

## Input

    { "roomId": "room-123", "targetUserId": "user-42", "reason": "Disruption" }

reason is optional and is truncated to 1000 characters in the kicked notification.

## Success outputs

- Actor receives successful moderationResult.
- All active target sockets receive kicked { roomId, userId, reason } and leave the room.
- Room receives userRemoved { roomId, userId }, userList, and micUpdate.
- Any temporary moderator role held by target is removed.

The user may join again immediately because no ban is saved.

## Validation

Actor must be an authorized moderator joined to the specified room. Authorization failures return moderationResult with success=false.

## Source

socket/moderation/moderation.events.js; socket/moderation/moderation.service.js; moderation.validation.js.

## LiveKit media

Handle microphone and participant changes through the LiveKit SDK as described in [LiveKit integration](../livekit.md). Socket.IO state changes do not directly change LiveKit server permissions or disconnect its participants.

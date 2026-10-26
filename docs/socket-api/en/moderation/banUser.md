# banUser

**Direction:** moderator client to server.

## Input

    { "roomId": "room-123", "targetUserId": "user-42", "reason": "Spam" }

roomId and targetUserId must be non-empty strings. reason is optional; Node truncates it to 1000 characters, matching Laravel's command contract.

## Success outputs

- Actor receives moderationResult with action banUser and success true.
- All active target sockets receive kicked { roomId, userId, reason }, leave the room, and lose their mic spots.
- Room receives userBanned { roomId, userId }, userList, and micUpdate.
- Future joinRoom using the same effective userId is rejected with joinRoomRejected code USER_BANNED.

## Validation and failures

The actor must be authenticated, joined to roomId, and authorized under moderation/common.md. Errors arrive as moderationResult, including INVALID_ROOM_ID, NOT_IN_ROOM, INVALID_TARGET_USER_ID, FORBIDDEN, SELF_TARGET, INSUFFICIENT_ROLE.

Laravel stores the ban even if the target has no active socket. Node changes its local mirror, removes active sockets, and emits success only after Laravel confirms the command. Room joins require JWT-backed identity.

## Source

socket/moderation/moderation.events.js; socket/moderation/moderation.service.js; moderation.validation.js; moderation.state.js.

## LiveKit media

Handle microphone and participant changes through the LiveKit SDK as described in [LiveKit integration](../livekit.md). Socket.IO state changes do not directly change LiveKit server permissions or disconnect its participants.

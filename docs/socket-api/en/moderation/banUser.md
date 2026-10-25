# banUser

**Direction:** moderator client to server.

## Input

    { "roomId": "room-123", "targetUserId": "user-42", "reason": "Spam" }

roomId and targetUserId must be non-empty strings. reason is optional; stored reason is limited to 300 characters.

## Success outputs

- Actor receives moderationResult with action banUser and success true.
- All active target sockets receive kicked { roomId, userId, reason }, leave the room, and lose their mic spots.
- Room receives userBanned { roomId, userId }, userList, and micUpdate.
- Future joinRoom using the same effective userId is rejected with joinRoomRejected code USER_BANNED.

## Validation and failures

The actor must be authenticated, joined to roomId, and authorized under moderation/common.md. Errors arrive as moderationResult, including INVALID_ROOM_ID, NOT_IN_ROOM, INVALID_TARGET_USER_ID, FORBIDDEN, SELF_TARGET, INSUFFICIENT_ROLE.

The ban is stored even if target has no active socket.

## Trust limitation

A JWT-backed target has an identity bound to sub. An unauthenticated client can claim any userId; bans are therefore not reliable against clients without JWT.

## Source

socket/moderation/moderation.events.js; socket/moderation/moderation.service.js; moderation.validation.js; moderation.state.js.

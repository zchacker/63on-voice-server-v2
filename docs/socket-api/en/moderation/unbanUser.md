# unbanUser

**Direction:** moderator client to server.

## Input

    { "roomId": "room-123", "targetUserId": "user-42" }

Both fields must be non-empty strings. The actor must be joined to this room and have a valid moderator role.

## Success outputs

- Actor receives moderationResult with action unbanUser and success true.
- Room receives userUnbanned { roomId, userId }.

## Failure

If no in-memory ban exists, moderationResult has success=false and code USER_NOT_BANNED. Other authorization/shape errors are documented in moderation/common.md.

Unbanning does not automatically rejoin a previously kicked socket. The user must emit joinRoom again.

## Source

socket/moderation/moderation.events.js; socket/moderation/moderation.service.js; moderation.validation.js; moderation.state.js.

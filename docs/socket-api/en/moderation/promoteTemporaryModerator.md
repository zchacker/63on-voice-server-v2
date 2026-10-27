# promoteTemporaryModerator

**Direction:** moderator client to server.

## Input

    { "roomId": "room-123", "targetUserId": "user-43" }

The target must currently be in this room, and every active socket for that user must have a verified JWT identity matching targetUserId.

## Success outputs

- Actor receives moderationResult with role temporary.
- Target sockets receive roleUpdated { roomId, userId, role: "temporary" }.
- Room receives moderatorUpdated with the same fields.

The role ends when the target's last socket leaves the room or disconnects.

## Failure codes

- TARGET_NOT_IN_ROOM
- TARGET_NOT_AUTHENTICATED
- FIXED_MODERATOR
- Plus common role and payload errors in moderation/common.md.

A temporary moderator cannot promote another moderator. The room owner, fixed moderator, or local root may grant this live temporary role. It is not stored by Laravel.

## Source

socket/moderation/moderation.events.js; socket/moderation/moderation.service.js; moderation.validation.js; moderation.state.js.

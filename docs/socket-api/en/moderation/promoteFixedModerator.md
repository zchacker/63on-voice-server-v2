# promoteFixedModerator

**Direction:** root moderator client to server.

## Input

    { "roomId": "room-123", "targetUserId": "user-44" }

Target may be offline. Only a root moderator can perform this action.

## Success outputs

- Actor receives moderationResult with role fixed.
- If target has active sockets in the room, they receive roleUpdated { roomId, userId, role: "fixed" }.
- Room receives moderatorUpdated { roomId, userId, role: "fixed" }.

The role remains after leaving the room but only until the Node process stops; no database persistence exists. Fixed role is applied when the user next joins.

## Failures

FORBIDDEN if actor is not root; INSUFFICIENT_ROLE if target is root; FIXED_MODERATOR if target already fixed. See moderation/common.md.

## Source

socket/moderation/moderation.events.js; socket/moderation/moderation.service.js; moderation.validation.js; moderation.state.js.

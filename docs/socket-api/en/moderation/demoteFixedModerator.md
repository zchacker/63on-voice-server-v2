# demoteFixedModerator

**Direction:** authenticated room owner client to server.

## Input

    { "roomId": "room-123", "targetUserId": "user-44" }

The target may be offline. Only the room owner can change a fixed moderator's persistent role. Laravel validates the current role and ownership.

## Success outputs

- Actor receives moderationResult with role normal and Laravel's current state snapshot.
- Active target sockets receive roleUpdated { roomId, userId, role: "normal" }.
- Room receives moderatorUpdated { roomId, userId, role: "normal" }.

Node sends action demote_fixed to Laravel before changing its local mirror or broadcasting success.

## Failures

FORBIDDEN if the actor is not the owner. Laravel may return PROTECTED_TARGET if the target is the owner or is not eligible for demotion. See moderation/common.md.

## Source

socket/moderation/moderation.events.js; socket/moderation/moderation.service.js; socket/moderation/moderation.validation.js; socket/moderation/moderation.state.js.

# promoteFixedModerator

**Direction:** authenticated room owner client to server.

## Input

    { "roomId": "room-123", "targetUserId": "user-44" }

The target may be offline. Laravel verifies that the actor owns the room and that the target is eligible.

## Success outputs

- Actor receives moderationResult with role fixed and Laravel's current state snapshot.
- If target has active sockets in the room, they receive roleUpdated { roomId, userId, role: "fixed" }.
- Room receives moderatorUpdated { roomId, userId, role: "fixed" }.

Node sends action promote_fixed to Laravel before changing its local mirror or broadcasting success. The role remains after the target leaves and survives Node restarts because Laravel stores it.

## Failures

FORBIDDEN if the actor is not the owner; PROTECTED_TARGET if target is an owner or root; LARAVEL_TIMEOUT or LARAVEL_UNAVAILABLE if the Laravel command could not be completed. See moderation/common.md.

## Source

socket/moderation/moderation.events.js; socket/moderation/moderation.service.js; socket/moderation/moderation.validation.js; socket/moderation/moderation.state.js.

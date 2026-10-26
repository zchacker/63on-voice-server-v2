# unlockMessages

**Direction:** moderator client to server.

## Input

    { "roomId": "room-123" }

The actor must be authenticated, joined to this room, and authorized by local validation and Laravel. The room owner, fixed moderators, and eligible temporary moderators may be authorized.

## Success output

- Actor receives moderationResult with action unlockMessages.
- Room receives messageLockUpdated { roomId, locked: false, changedBy, normalUsersOnly: false }.

All room members may send messages after the confirmed state change. Node sends unlock_messages to Laravel first and updates its local mirror and broadcasts only after Laravel confirms. Laravel persists the lock state.

## Source

socket/moderation/moderation.events.js; socket/moderation/moderation.service.js; moderation.validation.js; moderation.state.js.

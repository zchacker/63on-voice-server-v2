# unlockMessages

**Direction:** moderator client to server.

## Input

    { "roomId": "room-123" }

The actor must be in this room and hold root, fixed, or temporary role.

## Success output

- Actor receives moderationResult with action unlockMessages.
- Room receives messageLockUpdated { roomId, locked: false, changedBy, normalUsersOnly: false }.

All room members may send messages afterward. Calling unlockMessages on an already unlocked room also succeeds. State is in memory and lost on process restart.

## Source

socket/moderation/moderation.events.js; socket/moderation/moderation.service.js; moderation.validation.js; moderation.state.js.

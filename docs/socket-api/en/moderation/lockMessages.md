# lockMessages

**Direction:** moderator client to server.

## Input

    { "roomId": "room-123" }

The actor must be authenticated, joined to this room, and authorized by local validation and Laravel. The room owner, fixed moderators, and eligible temporary moderators may be authorized.

## Success output

- Actor receives moderationResult with action lockMessages.
- Room receives messageLockUpdated { roomId, locked: true, changedBy, normalUsersOnly: true }.

Normal users are blocked by sendMessage with messageRejected code MESSAGES_LOCKED. Authenticated moderators may continue sending messages.

## Behavior

Node sends lock_messages to Laravel first. The lock is persisted there; Node updates its local mirror and broadcasts messageLockUpdated only after Laravel confirms the locked state. A timeout or rejection returns success=false.

## Source

socket/moderation/moderation.events.js; socket/moderation/moderation.service.js; moderation.validation.js; moderation.state.js; socket/chat/chat.validation.js.

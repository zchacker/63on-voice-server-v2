# lockMessages

**Direction:** moderator client to server.

## Input

    { "roomId": "room-123" }

The actor must be in this room and hold root, fixed, or temporary role.

## Success output

- Actor receives moderationResult with action lockMessages.
- Room receives messageLockUpdated { roomId, locked: true, changedBy, normalUsersOnly: true }.

Normal users are blocked by sendMessage with messageRejected code MESSAGES_LOCKED. Authenticated moderators may continue sending messages.

## Behavior

Calling lockMessages for an already locked room succeeds. Lock state is in memory and lost on process restart.

## Source

socket/moderation/moderation.events.js; socket/moderation/moderation.service.js; moderation.validation.js; moderation.state.js; socket/chat/chat.validation.js.

# Moderation: Shared Rules

All commands use separate socket events; none use acknowledgement callbacks. Every request gets moderationResult on the requesting socket.

## Common request shape

Targeted action:

    { "roomId": "room-123", "targetUserId": "user-42" }

banUser and removeUser may add reason: string. lockMessages and unlockMessages use only roomId.

## moderationResult

    {
      "action": "banUser",
      "success": true,
      "code": "OK",
      "message": "Action completed.",
      "roomId": "room-123",
      "targetUserId": "user-42",
      "role": "temporary"
    }

targetUserId and role are optional. Failed commands use success=false with a stable code and message.

## Actor roles

- root: authenticated JWT subject is listed in SOCKET_ROOT_MODERATOR_IDS.
- fixed: fixed role assigned in the current Node process.
- temporary: role assigned for this room until the user's last socket leaves.
- normal: no moderator permission.

The actor must be in the room named in the request and have a valid JWT whose sub matches the joined userId. Client role fields do not grant privileges. Root can promote fixed moderators. Fixed and root moderators can promote temporary moderators. Temporary moderators may ban/kick, mute/unmute, and lock/unlock messages, but cannot promote.

Actors cannot target themselves or a root moderator. A non-root cannot target a fixed moderator. A fixed target cannot be promoted again.

## Error codes

Targeted commands may return INVALID_ROOM_ID, NOT_IN_ROOM, INVALID_TARGET_USER_ID, FORBIDDEN, SELF_TARGET, INSUFFICIENT_ROLE, FIXED_MODERATOR, TARGET_NOT_IN_ROOM, TARGET_NOT_AUTHENTICATED, or USER_NOT_BANNED. Lock commands may return NOT_IN_ROOM or FORBIDDEN. Every such error is carried in moderationResult.

## State lifetime

All moderation state is in memory and lost when the Node process restarts. Laravel is not called. No database durability is provided.

## Source

socket/moderation/moderation.events.js; moderation.service.js; moderation.validation.js; moderation.state.js.

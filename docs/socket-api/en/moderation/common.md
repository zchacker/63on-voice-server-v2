# Moderation: Shared Rules

Every command uses a separate Socket.IO event and returns moderationResult to the acting socket. There are no acknowledgement callbacks.

## Request shapes

Targeted action:

    { "roomId": "room-123", "targetUserId": "user-42" }

banUser and removeUser may include reason. lockMessages and unlockMessages use roomId only. demoteFixedModerator uses the same targeted shape as promoteFixedModerator. Any command may include an optional UUID `requestId`; reuse it when retrying the same attempt. Node generates one when omitted.

## moderationResult

    {
      "action": "banUser",
      "success": true,
      "code": "OK",
      "message": "Action completed.",
      "roomId": "room-123",
      "targetUserId": "user-42",
      "requestId": "9d3d2333-315b-4e85-bb2c-6f3fdd586975",
      "occurredAt": "2026-10-26T10:30:00.000Z",
      "state": {
        "banned": true,
        "role": "normal",
        "micMuted": false,
        "messagesLocked": false
      }
    }

targetUserId and role may be omitted when they do not apply. Persistent actions include Laravel's state snapshot. Failed commands return success=false with code and message.

## Roles and authorization

- owner: room owner resolved by Laravel.
- fixed: persistent moderator role loaded from Laravel.
- temporary: room-only role held in Node memory; it ends when the user's last socket leaves.
- root: local ID configured in SOCKET_ROOT_MODERATOR_IDS. It does not bypass Laravel authorization for saved commands.
- normal: no moderator permission.

A verified Socket JWT is required to join or moderate, and the JWT subject must match the joined userId. Client-supplied role fields never grant permission. Laravel validates saved moderation commands again.

Only the owner can promote or demote a fixed moderator. Owners, fixed moderators, and temporary moderators can perform operational commands allowed by Laravel. A fixed moderator must be demoted before being targeted by another moderation action. Users cannot target themselves or the room owner.

## Persistence and failure behavior

banUser, unbanUser, promoteFixedModerator, demoteFixedModerator, muteMic, unmuteMic, lockMessages, and unlockMessages are sent to Laravel before Node changes its local mirror or broadcasts success. Laravel is the durable source of truth for banned state; Node keeps no independent ban list. `state.banned` is taken from Laravel's command response. Existing `userBanned` and `userUnbanned` events keep `{ roomId, userId }` and are emitted only after Laravel confirms the saved action.

Laravel's moderation command route records successful durable actions and authorization/business rejections. Socket also sends every attempt to Laravel's separate two-phase audit-events API; this records local rejections and preserves the final result with the same requestId.

promoteTemporaryModerator and removeUser are live Socket operations, not persistent role or ban changes. Their attempts are now visible in Laravel's moderation-events history. A temporary role is removed when the user's final active socket leaves the room. Laravel is queried on each join to restore persistent role, ban eligibility, mic mute, and message lock state.

banUser and removeUser also remove an active participant through the LiveKit server API before the target is notified with `kicked`. Laravel's join authorization response includes the trusted `room.liveKitRoomName` (`rooms.username`). Laravel's `POST /api/room/join` rejects an active room ban with `USER_BANNED` before issuing a LiveKit token.

The state response for a successful saved command contains the current fields banned, role, micMuted, and messagesLocked. Clients should use this snapshot to refresh controls.

Each Node worker mirrors state in its own process. No cross-worker Socket.IO adapter is configured, so immediate live broadcasts currently reach sockets on the worker that received the command.

Room metadata broadcasts use the internal Laravel-to-Node endpoint documented in [roomUpdated](../rooms/roomUpdated.md). The Socket endpoint is ready, but Laravel does not yet call it after a room update; the feature is not end-to-end until that callback is added.

## Common error codes

INVALID_ROOM_ID, AUTHENTICATION_REQUIRED, NOT_IN_ROOM, INVALID_TARGET_USER_ID, FORBIDDEN, SELF_TARGET, PROTECTED_TARGET, TARGET_NOT_IN_ROOM, TARGET_NOT_AUTHENTICATED, USER_NOT_BANNED, LARAVEL_TIMEOUT, LARAVEL_UNAVAILABLE, LARAVEL_SERVICE_AUTH_FAILED, LARAVEL_STATE_MISMATCH.

## Source

socket/moderation/moderation.events.js; moderation.service.js; moderation.validation.js; moderation.state.js; services/laravel.service.js.


## Recovery after a lost Laravel response

Node retries a transient request failure up to three times using the identical requestId and payload. It keeps both requestId integrity checks. If the outcome remains unknown, active members receive kicked and leave the room without a success broadcast. The pending command stays in memory; a new join must first retrieve its result using that UUID, then obtain fresh authorize-join state. A definitive Laravel rejection clears the pending command.

Moderation accepts the canonical roomId string (or its safe numeric form) and the identifier used by the actor when joining. Server replies use the canonical roomId. state.role uses Laravel values owner/fixed_moderator/normal; roleUpdated uses owner/fixed/temporary/root/normal.

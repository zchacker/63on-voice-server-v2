# banUser

**Direction:** moderator client to server.

## Input

    { "roomId": "room-123", "targetUserId": "user-42", "reason": "Spam" }

roomId and targetUserId must be non-empty strings. reason is optional; Node truncates it to 1000 characters, matching Laravel's command contract.

## Success outputs

- Actor receives moderationResult with action banUser and success true.
- After Socket membership is cleared, active target sockets receive kicked { roomId, userId, reason } and lose their mic spots.
- Room receives userBanned { roomId, userId }, userList, and micUpdate.
- Future joinRoom using the same effective userId is rejected with joinRoomRejected code USER_BANNED.

## Validation and failures

The actor must be authenticated, joined to roomId, and authorized under moderation/common.md. Errors arrive as moderationResult, including INVALID_ROOM_ID, NOT_IN_ROOM, INVALID_TARGET_USER_ID, FORBIDDEN, SELF_TARGET, INSUFFICIENT_ROLE.

Laravel stores the ban even if the target has no active socket. Node does not mirror the banned-user list; it uses Laravel's returned `state.banned`. After Laravel confirms the ban, Node removes an active LiveKit participant, ends active Socket membership, and emits userBanned with the existing payload. A LiveKit error returns a failed moderationResult while the durable ban remains in place. Laravel must reject new LiveKit tokens for the banned user; the inspected backend endpoint still needs this check.

## Source

socket/moderation/moderation.events.js; socket/moderation/moderation.service.js; moderation.validation.js; moderation.state.js.

## LiveKit media

Node removes the target's active participant through the LiveKit Server API. The frontend should still leave its local LiveKit room after `kicked`. See [LiveKit integration](../livekit.md).

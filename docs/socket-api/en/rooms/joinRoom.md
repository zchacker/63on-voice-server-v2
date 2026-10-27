# joinRoom

**Direction:** client to server.

## Input

    { "roomId": "room-123" }

roomId may be the database ID as a positive safe integer or a non-empty string. Laravel also supports room usernames. Node uses the canonical database ID returned by Laravel for all membership and moderation state.

The optional legacy user object is accepted but ignored. The server never trusts profile, identity, or role fields from the client. A valid Socket JWT is required to join.

## Server flow

1. Node takes the user ID from the verified JWT sub claim.
2. Node calls Laravel POST /api/internal/socket/v1/rooms/{roomId}/authorize-join with userId and the current Socket.IO connectionId.
3. Laravel checks the room, the user's membership/access, bans, persistent role, microphone mute, and message-lock state.
4. The trusted room object includes `liveKitRoomName`, equal to the Laravel `rooms.username`; Socket keeps this server-only value for LiveKit moderation.
5. Node joins the Socket.IO room only when Laravel returns allowed=true and a matching user ID.
6. After local membership is established, Node asynchronously posts an internal `joined` presence notification to Laravel so Laravel can refresh `rooms.online_count`. This is not a client-facing Socket event; notification failures are logged and do not undo a successful join. See [the Laravel presence contract](../../../../LARAVEL_ROOM_PRESENCE_REQUEST.md).

## Success outputs

- Room receives userList containing Laravel's trusted user profile plus socketId.
- Room receives micUpdate with the current spot-number-to-user object, or {}.
- Joining socket receives roleUpdated { roomId, userId, role } where role is owner, fixed, temporary, root, or normal.
- Joining socket receives messageLockUpdated { roomId, locked, normalUsersOnly }.
- A muted user also receives micMuted { roomId, userId }.

This event has no acknowledgement callback. Treat the joining user appearing in userList as the practical success signal.

## Rejections

joinRoomRejected includes roomId, userId, code, and message. Codes include:
- INVALID_ROOM_ID: roomId is neither a non-empty string nor a positive safe integer.
- AUTHENTICATION_REQUIRED: the handshake did not contain a valid Socket JWT.
- USER_BANNED, ROOM_NOT_FOUND, ROOM_INACTIVE, USER_NOT_FOUND, JOIN_NOT_ALLOWED: Laravel denied the join.
- LARAVEL_TIMEOUT, LARAVEL_UNAVAILABLE, SOCKET_CONFIGURATION_MISSING: Node could not complete the internal Laravel authorization call.
- INVALID_LARAVEL_RESPONSE or INVALID_LARAVEL_IDENTITY: Laravel returned a malformed decision or a user ID that did not match JWT sub.

If a request to join a new room is denied, the socket stays in its previously joined room. A successful rejoin leaves the previous room after Laravel authorizes the new room.

## Behavior notes

Laravel is the source of truth for user profile and persistent room state. Different accepted identifiers for the same room resolve to one Socket.IO room. Server event roomId values are the canonical ID as a string; use that ID for subsequent moderation commands. The in-memory ban check is not used to authorize joins.

## Source

socket/rooms/room.events.js; socket/rooms/room.service.js; socket/rooms/room.validation.js; services/laravel.service.js.

If a pending moderation outcome cannot yet be reconciled, the join is rejected. ROOM_STATE_UNCERTAIN means Laravel returned no trustworthy command result; retry only after service recovery. ROOM_CHANGED requires a fresh join because the identifier resolved to another room during authorization.

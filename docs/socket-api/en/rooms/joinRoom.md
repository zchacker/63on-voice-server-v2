# joinRoom

**Direction:** client to server.

## Input

    {
      "roomId": "room-123",
      "user": {
        "userId": "user-42",
        "name": "Sara",
        "avatar": "https://example.com/sara.png"
      }
    }

roomId must be a non-empty string. user must be a plain object. Without a valid JWT, user.userId must be a non-empty string. If the connection has a valid JWT, JWT sub replaces the supplied userId; userId may be omitted in that case. The server removes role, isModerator, and permissions from the user object.

## Success outputs

- Room receives userList: one entry per connected socket. Server adds socketId to this user's object; other client-supplied fields pass through except role, isModerator, and permissions, which are removed.
- Room receives micUpdate: current spot-number-to-user object, or {}.
- Joining socket receives roleUpdated { roomId, userId, role }.
- Joining socket receives messageLockUpdated { roomId, locked, normalUsersOnly }.
- If this identity is muted, joining socket also receives micMuted { roomId, userId }.

This event has no acknowledgement callback.

## Rejections

joinRoomRejected { code, message }:
- INVALID_ROOM_ID: roomId missing, empty, or not a string.
- INVALID_USER: user missing, not an object, or an array.
- INVALID_USER_ID: userId missing/invalid and no JWT identity is available.
- USER_BANNED: current in-memory ban exists for roomId and effective userId.

## Behavior notes

A JWT identity takes precedence over client-supplied userId. Without JWT, identity is client-controlled. The server does not consult Laravel to verify room existence, ownership, membership, or private-room access. Rejoining the same socket first leaves its previous room.

## Source

socket/rooms/room.events.js; socket/rooms/room.service.js; socket/rooms/room.validation.js.

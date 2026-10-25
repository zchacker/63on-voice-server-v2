# Socket.IO API for Frontend Developers

This guide describes the current Socket.IO behavior and the input/output fields. Event and field names are case-sensitive.

## Connection and authentication

- Endpoint: http://<HOST>:<PORT> or https://<HOST>:<PORT>; default port is 3000.
- Send a JWT in the handshake as auth.token. Do not put it in the URL.
- Regular connections without a token are currently allowed. Moderation privileges require an HS256-signed JWT with the user's ID in sub.
- Server configuration: SOCKET_JWT_SECRET is the signing secret; SOCKET_ROOT_MODERATOR_IDS is a comma-separated list of root moderator IDs.
- When a valid JWT is present, the server uses sub as the user's identity and replaces user.userId from joinRoom.
- Send JWTs for every user to make identity-based bans and mutes reliable. A connection without a JWT does not get moderator privileges.

Connection example:

    import { io } from "socket.io-client";
    const socket = io("https://<HOST>", { auth: { token: "<HS256-JWT>" } });

The JWT must contain sub. It may also contain exp and nbf. A rejected token produces the client's connect_error event.

## Response format

Current events do not use callbacks or Socket.IO acknowledgements. Results arrive as separate events. Many errors use this shape:

    { "code": "ERROR_CODE", "message": "Readable explanation" }

## Room and microphone events

| Client emits | Input | Success and server events | Error |
| --- | --- | --- | --- |
| joinRoom | { roomId: string, user: { userId: string, name?: string, avatar?: string, ... } } | Server broadcasts userList and micUpdate; joining client receives roleUpdated and messageLockUpdated. | joinRoomRejected { code, message } |
| leaveRoom | No payload | Broadcasts userList and micUpdate when microphone spots change. A temporary moderator role ends after their last connection leaves. | No defined error response currently. |
| requestMic | { spotNumber: integer } from 0 to 7 | Requester receives takeMic { spotNumber }; room receives micUpdate. | micRequestRejected { code, message } or micRejected if occupied. |
| leaveMic | { spotNumber: integer } from 0 to 7 | Requester receives leaveMic { spotNumber }; room receives micUpdate. | micLeaveRejected { code, message } |
| audioData | Any Socket.IO-serializable payload | Other room members receive audioData { userId, audio }. | audioDataRejected { code, message } |
| sendMessage | Any non-null value; preferably an agreed message object | Room members receive newMessage { message, user }. | messageRejected { code, message } |
| sendGift | Any gift payload agreed by the application | Room members receive sendGift { gift, user }. | giftRejected { code, message } |

Example:

    socket.emit("joinRoom", {
      roomId: "room-123",
      user: { userId: "user-42", name: "Sara", avatar: "https://example.com/sara.png" }
    });
    socket.emit("requestMic", { spotNumber: 2 });
    socket.emit("sendMessage", { id: "msg-1", text: "Hello" });
    socket.emit("sendGift", { id: "gift-1", name: "Rose" });

userList is an array of users, with socketId added by the server. Use the stable application userId; socketId belongs to one connection. micUpdate is an object keyed by spot number, with user objects as values. The server does not enforce a fixed schema for message or gift objects.

## Moderation events

The actor must be in roomId and have a valid JWT. The actor receives moderationResult:

    {
      "action": "banUser",
      "success": true,
      "code": "OK",
      "message": "Action completed.",
      "roomId": "room-123",
      "targetUserId": "user-42"
    }

On failure, success is false, and code and message explain why. Promotion results include role. Clients cannot assign themselves roles through the user object; the server resolves roles from moderation state and the JWT identity.

| Client emits | Input | Success events |
| --- | --- | --- |
| banUser | { roomId, targetUserId, reason? } | Actor receives moderationResult; target receives kicked { roomId, userId, reason }; room receives userBanned { roomId, userId }, userList, and micUpdate. A later join attempt is rejected with joinRoomRejected. |
| unbanUser | { roomId, targetUserId } | moderationResult; room receives userUnbanned { roomId, userId }. |
| removeUser | { roomId, targetUserId, reason? } | Kicks without recording a ban; moderationResult, kicked, userRemoved { roomId, userId }, userList, and micUpdate. |
| promoteTemporaryModerator | { roomId, targetUserId } | moderationResult with role="temporary"; target receives roleUpdated and room receives moderatorUpdated. Target must be present. |
| promoteFixedModerator | { roomId, targetUserId } | Same as temporary promotion with role="fixed". Only a root moderator can grant this role. It remains after room exit until the server process stops. |
| muteMic | { roomId, targetUserId } | moderationResult; target receives micMuted { roomId, userId }; room receives micModerationUpdated { roomId, userId, muted: true } and micUpdate. |
| unmuteMic | { roomId, targetUserId } | moderationResult; target receives micUnmuted { roomId, userId }; room receives micModerationUpdated { roomId, userId, muted: false }. |
| lockMessages | { roomId } | moderationResult; room receives messageLockUpdated { roomId, locked: true, changedBy, normalUsersOnly: true }. Regular users are blocked, while moderators can still send. |
| unlockMessages | { roomId } | moderationResult; room receives messageLockUpdated { roomId, locked: false, changedBy, normalUsersOnly: false }. |

Required moderationResult fields are action, success, code, message, and roomId. targetUserId may be absent for message-lock actions.
Target-specific events are sent when the target is connected. A muted user receives micMuted again on joining so the frontend can restore its state.

Command and response examples:

    socket.emit("banUser", { roomId: "room-123", targetUserId: "user-42", reason: "Spam" });
    socket.emit("promoteTemporaryModerator", { roomId: "room-123", targetUserId: "user-43" });
    socket.emit("promoteFixedModerator", { roomId: "room-123", targetUserId: "user-44" });
    socket.emit("muteMic", { roomId: "room-123", targetUserId: "user-42" });
    socket.emit("unmuteMic", { roomId: "room-123", targetUserId: "user-42" });
    socket.emit("lockMessages", { roomId: "room-123" });
    socket.emit("unlockMessages", { roomId: "room-123" });

    socket.on("moderationResult", (result) => {
      if (!result.success) showError(result.message);
    });
    socket.on("messageLockUpdated", ({ locked }) => updateChatLock(locked));
    socket.on("roleUpdated", ({ role }) => updateMyRole(role));
    socket.on("micMuted", () => stopPublishingAudio());
    socket.on("kicked", () => leaveRoomView());

## Roles and permissions

- root: ID appears in SOCKET_ROOT_MODERATOR_IDS and has a valid JWT with a matching sub. Can moderate and promote fixed moderators.
- fixed: fixed room moderator; can moderate and promote temporary moderators.
- temporary: can ban/kick users, mute/unmute microphones, and lock/unlock messages. Cannot promote moderators.
- normal: regular user.

Moderators cannot manage root moderators. Fixed moderators are protected from fixed and temporary moderators; root can manage other roles. A fixed moderator cannot be changed to temporary. Optional reason is truncated to 300 characters when stored.

## Storage and current behavior

Bans, roles, microphone mutes, and message locks currently live in Node.js process memory. A fixed role survives leaving the room, and these states remain while the process runs, but they are lost on server restart. socket/moderation/moderation.state.js is the boundary for a future Laravel storage integration. The frontend event contract can remain unchanged, but persistence across restarts requires that integration.

The server verifies the moderator's JWT signature. Send JWTs for all users. The server currently allows sessions without JWT to join as regular users, so do not rely on bans for an unverified identity; those users cannot receive moderator privileges.

## Common error codes

- AUTHENTICATION_FAILED: JWT rejected during connection.
- FORBIDDEN: actor lacks the required role.
- NOT_IN_ROOM: join the room before sending the request.
- INVALID_MIC_SPOT: spot number must be an integer from 0 to 7.
- MIC_MUTED: moderator mute blocks mic requests and audioData.
- MESSAGES_LOCKED: chat is locked for regular users.
- TARGET_NOT_IN_ROOM: temporary promotion requires the target to be present.
- TARGET_NOT_AUTHENTICATED: temporary promotion requires the target to have a valid JWT session.
- USER_NOT_BANNED: there is no ban to remove.

## Suggested event listeners

    socket.on("userList", (users) => renderUsers(users));
    socket.on("micUpdate", (spots) => renderMicSpots(spots));
    socket.on("newMessage", ({ message, user }) => appendMessage(user, message));
    socket.on("sendGift", ({ gift, user }) => showGift(user, gift));
    socket.on("audioData", ({ userId, audio }) => playAudio(userId, audio));
    socket.on("moderatorUpdated", ({ userId, role }) => updateRoomMemberRole(userId, role));
    socket.on("micModerationUpdated", ({ userId, muted }) => updateMemberMute(userId, muted));
    socket.on("userBanned", ({ userId }) => removeMember(userId));
    socket.on("userUnbanned", ({ userId }) => refreshBanState(userId));
    socket.on("userRemoved", ({ userId }) => removeMember(userId));
    socket.on("connect_error", (error) => showConnectionError(error.message));

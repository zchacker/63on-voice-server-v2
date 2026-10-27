# Frontend Integration Guide

This guide gives a practical, end-to-end path for connecting a frontend to the current Socket.IO server. It complements the per-event specifications in this folder; those pages remain the source for each event's detailed contract.

Voice media uses [LiveKit](livekit.md) at livekit.63on.com; Socket.IO manages application events. Obtain the LiveKit token from Laravel /api/room/join separately from the Socket JWT.

## 1. Gather the connection values

The frontend needs the Socket server origin, roomId, and a short-lived Socket JWT. Obtain that JWT from Laravel POST /api/socket/session after normal Laravel login. The client does not need to send a user ID or role as proof of identity.

The server uses the default port 3000 unless PORT is configured. It currently allows all CORS origins. Production should still use the intended HTTPS origin.

The client should use the Socket.IO client library, socket.io-client. Do not use a raw WebSocket client.

## 2. Get a token the Socket server accepts

After login, call Laravel POST /api/socket/session with the user's Sanctum authentication and use the returned socket_token. Sanctum access tokens are not JWTs. The Socket server accepts only an HS256 JWT with typ=JWT, matching sub, exp, iss, and aud claims; nbf is checked when present. Issuer and audience default to 63on-backend and 63on-socket. The same SOCKET_JWT_SECRET value must be configured in Laravel and Node. Never put either server secret in the frontend.

The transport connection may open without a token, but joinRoom requires a valid Socket JWT. A client-supplied userId is never trusted.

The mobile app requests the token before connecting:

    const response = await fetch(laravelOrigin + "/api/socket/session", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + sanctumToken,
        "Accept": "application/json"
      }
    });
    if (!response.ok) throw new Error("Socket session could not be issued.");
    const session = await response.json();
    const socketJwt = session.socket_token;
    const userId = String(session.user.id);

JWT establishes identity. Node also calls Laravel's internal authorize-join endpoint to check this room and persisted bans before accepting joinRoom. The phone sends only { roomId }; all returned roomId fields use the canonical database ID as a string.

## 3. Create the socket and register listeners before connecting

    import { io } from "socket.io-client";

    const socket = io("https://<SOCKET_HOST>", {
      autoConnect: false,
      reconnection: true,
      auth: { token: socketJwt }
    });

    socket.on("connect", () => {
      // Runs on the first connection and on every successful reconnection.
      socket.emit("joinRoom", { roomId });
    });

    socket.on("connect_error", (error) => {
      // For an invalid JWT, the message starts with AUTHENTICATION_FAILED.
      showConnectionError(error.message);
    });

    socket.on("joinRoomRejected", ({ code, message }) => {
      showJoinError(code, message);
    });

    socket.on("userList", (users) => {
      updateRoomUsers(users);
      // Treat the room as joined when this list contains the current userId.
    });

    socket.on("micUpdate", (spots) => updateMicSpots(spots));
    socket.on("roleUpdated", ({ role }) => updateMyRole(role));
    socket.on("messageLockUpdated", (state) => updateMessageLock(state));
    socket.on("micMuted", () => stopLiveKitMicrophonePublishing());
    socket.on("micUnmuted", () => showMicrophoneAvailable());

    socket.connect();

Register all listeners before calling connect so the initial room state is not missed. The backend does not send a join acknowledgement or a dedicated roomJoined event. On success it broadcasts userList and micUpdate to the room and sends roleUpdated/messageLockUpdated to the joining socket. Use userList containing the current user as the practical join confirmation. Do not enable room actions before that confirmation.

## 4. Rejoin after reconnect

Socket.IO creates a new server-side socket after a connection is lost. The server does not restore room membership automatically. The connect handler above emits joinRoom after every connection, which rejoins the room and reloads userList, micUpdate, role and lock state.

A disconnect also runs server cleanup. It clears the user's mic spots and can remove a temporary moderator role after the last socket disconnects. Therefore, after reconnect the frontend must use the newly received roleUpdated value; do not assume a temporary role survived.

If refreshing a token, update socket.auth before reconnecting:

    socket.auth = { token: refreshedSocketJwt };
    socket.disconnect();
    socket.connect();

The disconnect/connect sequence creates a fresh handshake and triggers the connect handler to rejoin the room. The server disconnects the socket at token expiry and blocks events after expiry. Refresh the token before exp, then reconnect with the new token.

## 5. Room lifecycle

Join after the user is authenticated and the Socket JWT is ready:

    socket.emit("joinRoom", { roomId });

Node uses the verified JWT subject and asks Laravel to authorize the room before joining. Laravel supplies the trusted profile and persisted moderation state. If joining a new room is denied, existing room membership stays active.

Leave intentionally before navigating away:

    socket.emit("leaveRoom");

There is no leave acknowledgement. The server broadcasts updated userList and, when a mic spot changed, micUpdate. A later disconnect also cleans up the room.

Laravel now checks room access through authorize-join before Node adds the socket to the room. Node rejects the join if Laravel denies access or cannot be reached.

## 6. Send messages and gifts

The server does not prescribe message or gift schemas. Agree on the object shapes with the Laravel/product team. The examples below are frontend conventions, not enforced backend schemas.

    socket.emit("sendMessage", {
      id: "msg-123",
      text: "Hello",
      createdAt: new Date().toISOString()
    });

    socket.emit("sendGift", {
      id: "gift-rose",
      name: "Rose"
    });

Listen for the room broadcasts:

    socket.on("newMessage", ({ message, user }) => appendMessage(user, message));
    socket.on("sendGift", ({ gift, user }) => showGift(user, gift));

Messages are echoed to the sender as well as other room members. Gifts are only broadcast: the server does not verify price, balance, payment or inventory.

When chat is locked, normal users receive messageRejected with MESSAGES_LOCKED. Moderators may continue to send messages.

## 7. Audio and microphone seats: LiveKit

The application carries all voice media through LiveKit at wss://livekit.63on.com. Request its token from Laravel POST /api/room/join and use data.token with the LiveKit SDK. This differs from the Socket JWT issued by /api/socket/session.

Read [LiveKit integration](livekit.md) for the exact request/response, room.id versus room.username mapping, connection order, and current enforcement limits.

Socket.IO events coordinate seats 0–7 and update the UI:

    socket.emit("requestMic", { spotNumber: 2 });
    socket.on("takeMic", ({ spotNumber }) => {
      // Enable/publish the microphone using the platform's LiveKit SDK.
    });
    socket.on("micMuted", () => {
      // Disable/unpublish the microphone using LiveKit.
    });
    socket.emit("leaveMic", { spotNumber: 2 });
    socket.on("leaveMic", () => {
      // Disable/unpublish the microphone using LiveKit.
    });

Handle micRejected for occupied seats, micRequestRejected for invalid/muted requests, and micLeaveRejected for rejected releases. These events do not carry media. On kicked or intentional exit, leave the LiveKit room too.

audioData and audioDataRejected are legacy source events. Do not implement audio streaming or playback with them in the current frontend.

## 8. Moderation workflow

Register moderationResult and room state listeners before enabling moderation controls:

    socket.on("moderationResult", (result) => {
      if (!result.success) showError(result.code, result.message);
    });
    socket.on("moderatorUpdated", ({ userId, role }) => updateMemberRole(userId, role));
    socket.on("micModerationUpdated", ({ userId, muted }) => updateMemberMute(userId, muted));
    socket.on("userBanned", ({ userId }) => removeMember(userId));
    socket.on("userUnbanned", ({ userId }) => refreshBanState(userId));
    socket.on("userRemoved", ({ userId }) => removeMember(userId));
    socket.on("kicked", ({ reason }) => leaveRoomView(reason));

Every targeted action uses the target's stable userId, not socketId:

    const target = { roomId, targetUserId };

    socket.emit("banUser", { ...target, reason: "Spam" });
    socket.emit("unbanUser", target);
    socket.emit("removeUser", { ...target, reason: "Disruption" });
    socket.emit("promoteTemporaryModerator", target);
    socket.emit("promoteFixedModerator", target);
    socket.emit("demoteFixedModerator", target);
    socket.emit("muteMic", target);
    socket.emit("unmuteMic", target);

    socket.emit("lockMessages", { roomId });
    socket.emit("unlockMessages", { roomId });

The actor receives moderationResult for success and failure. It contains action, success, code, message, roomId, optionally targetUserId/role, and a state snapshot for persistent actions. There are no callbacks, so do not wait on an emit callback.

Current role rules:
- owner is resolved by Laravel for the room; fixed roles are loaded from Laravel.
- Only the room owner can promote or demote a fixed moderator.
- owner, fixed moderators, and local root IDs can promote a temporary moderator; the target must be present and every active target socket must have a valid JWT.
- temporary moderator rights end when the user's last socket leaves/disconnects.
- fixed moderator rights are stored by Laravel and survive Node restarts.
- root IDs from SOCKET_ROOT_MODERATOR_IDS do not bypass Laravel authorization for saved actions.
- role fields supplied by the client do not grant permissions.

A successful ban is saved by Laravel before active sockets are removed and kicked. Laravel rejects later joins while the ban remains active. unbanUser is saved by Laravel and does not reconnect the user automatically. removeUser kicks without saving a ban.

## 9. Handle errors and state

Common client handling:

    socket.on("messageRejected", ({ code, message }) => showMessageError(code, message));
    socket.on("micRequestRejected", ({ code, message }) => showMicError(code, message));
    socket.on("micRejected", ({ code, message }) => showMicError(code, message));
    socket.on("micLeaveRejected", ({ code, message }) => showMicError(code, message));
    socket.on("giftRejected", ({ code, message }) => showGiftError(code, message));

For moderation, handle failures through moderationResult rather than separate error events. Some common codes are NOT_IN_ROOM, INVALID_MIC_SPOT, MIC_MUTED, MESSAGES_LOCKED, FORBIDDEN, SELF_TARGET, INSUFFICIENT_ROLE, TARGET_NOT_IN_ROOM and TARGET_NOT_AUTHENTICATED.

Laravel is the durable source for bans, fixed roles, microphone mutes, and message locks. Each join reloads the authorized user and room state. Temporary moderator assignments and live room/microphone membership stay in Node memory and are lost on restart. Multiple Node workers do not yet share live Socket.IO broadcasts.

## 10. Full event specifications

Use these pages for exact per-event inputs, outputs and edge cases:

- rooms/joinRoom.md, rooms/requestMic.md, rooms/leaveMic.md, rooms/audioData.md
- users/leaveRoom.md, users/disconnect.md
- chat/sendMessage.md, gifts/sendGift.md
- moderation/common.md and each page under moderation/

## Source scope

This guide was checked against event handlers and their services/validation under socket/. demo/ is excluded.

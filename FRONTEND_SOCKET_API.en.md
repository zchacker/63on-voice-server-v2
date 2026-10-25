# Socket.IO API for the Frontend

This document describes the server's current behavior. Use it as an integration reference, and read the limitations section before relying on user-removal or audio events.

## Connection

- Protocol: Socket.IO (built on Engine.IO; this is not a raw WebSocket connection).
- URL: `http://<HOST>:<PORT>` or `https://<HOST>:<PORT>`, depending on the deployment setup.
- Default port: `3000`; it can be changed with `PORT`.
- No authentication or handshake data is currently required.
- The current CORS configuration allows all origins.

JavaScript example:

```js
import { io } from "socket.io-client";

const socket = io("https://<HOST>");
```

## Usage

Incoming events are event names sent by the frontend with `socket.emit`. Outgoing events are received with `socket.on`. The current server does not use acknowledgements or callbacks; responses arrive as separate events.

Send `joinRoom` before sending messages, gifts, or microphone requests. Most events do not return an error for a missing payload or a request made outside a room; the request may be ignored or may cause a server error.

## Events sent to the server

| Event | Payload | Meaning |
| --- | --- | --- |
| `joinRoom` | `{ roomId: string, user: object }` | Join a room and register user data. The server adds `socketId` to the user object. |
| `requestMic` | `{ spotNumber: number }` | Request a microphone spot. If it is occupied, the server emits `micRejected`. |
| `leaveMic` | `{ spotNumber: number }` | Request release of a microphone spot. |
| `audioData` | Any value serializable by Socket.IO | Send audio data; currently the server broadcasts it to every other connection. |
| `sendMessage` | Any value serializable by Socket.IO | Publish a message to the room. |
| `sendGift` | Any value serializable by Socket.IO | Publish a gift to the room. |
| `removeUser` | `{ roomId: string, targetUserId: string }` | Attempt to remove a user from the room; the current implementation has a bug described below. |

### Example: join a room and send a message

```js
socket.emit("joinRoom", {
  roomId: "room-123",
  user: {
    userId: "user-42",
    name: "User name",
    avatar: "https://example.com/avatar.png"
  }
});

socket.emit("sendMessage", {
  text: "Hello",
  clientMessageId: "msg-001"
});
```

The server does not define a fixed schema for `user`, `message`, or `gift`; it forwards these values as received. The frontend and product team should agree on the fields for these objects.

## Events sent by the server

| Event | Recipient | Payload |
| --- | --- | --- |
| `userList` | All room members | Array of registered users. Each user contains at least the fields sent by the client, plus `socketId`. |
| `micUpdate` | All room members | Object keyed by spot number, with user objects as values. For example: `{ "1": { "userId": "user-42", "name": "User name" } }`. It may be `{}` when no spots are occupied. |
| `takeMic` | The user who requested the spot | `{ spotNumber: number }`. Tells the frontend to begin publishing audio. |
| `micRejected` | The user whose request was rejected | `{ spotNumber: number, reason: string }`. Current reason for an occupied spot: `تم أخذ المكان بالفعل` ("The spot has already been taken"). |
| `leaveMic` | The user who requested to leave | `{ spotNumber: number }`. The server sends this as a request acknowledgement, before checking whether the user owns the spot. |
| `audioData` | Every other connection to the server | `{ userId: socket.id, audio: <sent payload> }`. Here, `userId` is the socket ID, not `user.userId`. |
| `newMessage` | Room members | `{ message: <sent payload>, user: <user registered on the socket> }`. |
| `sendGift` | Room members | `{ gift: <sent payload>, user: <user registered on the socket> }`. |
| `kicked` | The target user (intended) | No payload. This event is currently unreliable because of the `removeUser` bug. |
| `userRemoved` | Room members (intended) | `{ userId: targetUserId }`. This event is currently unreliable because of the `removeUser` bug. |

When a user joins, the server sends `userList` to the room. It sends `micUpdate` if microphone state exists. There are currently no `userJoined` or `userLeft` events.

## Listening examples

```js
socket.on("userList", (users) => renderUsers(users));
socket.on("micUpdate", (spots) => renderMicSpots(spots));
socket.on("takeMic", ({ spotNumber }) => startPublishingAudio(spotNumber));
socket.on("micRejected", ({ spotNumber, reason }) => showError(reason));
socket.on("newMessage", ({ message, user }) => appendMessage(user, message));
socket.on("sendGift", ({ gift, user }) => showGift(user, gift));
socket.on("audioData", ({ userId, audio }) => playAudio(userId, audio));
socket.on("kicked", () => leaveRoomView());
```

## Important details and limitations

- `requestMic` rejects a spot only when its number is greater than 7 or the spot is occupied. It does not currently check that the number is a positive integer or enforce a consistent range. Spot 7 is accepted, but disconnect cleanup only checks spots 0 through 6.
- A user can request more than one spot; there is no check preventing this.
- `leaveMic` only releases the spot if the stored user's `userId` matches, but the server emits `leaveMic` to the client before that check.
- `audioData` uses `socket.broadcast` at the server level, not `socket.to(roomId)`, so users outside the room also receive it. The server does not verify microphone ownership.
- `removeUser` should not currently be relied on: members are stored in a `Set`, but the service treats the collection as a `Map` and calls `.get`. There is also no admin authorization check. Do not use this event until it is fixed.
- `sendGift` only broadcasts the supplied data to the room; the server does not verify balance, payment, or gift eligibility.
- There is no authentication, authorization, payload schema validation, or agreed general error format.
- Room and microphone state is stored in the Node.js process memory. It is lost on restart and is not shared across multiple processes.
- On disconnect, the matching user is removed and `userList` and `micUpdate` are sent, but deleting an empty room is not enabled.

## Suggested frontend data shapes

The server does not enforce these schemas yet; they are a suggested team convention. Keep `userId` stable and unique at the application level, and do not rely on `socketId` as a permanent identifier.

```ts
type User = {
  userId: string;
  name?: string;
  avatar?: string;
  // Additional display fields as needed by the application
};

type ChatMessage = {
  id?: string;
  text: string;
  createdAt?: string;
};

type Gift = {
  id: string;
  name?: string;
  // This does not mean the server verified payment or balance
};
```

## Contract source

See the implementation in `socket/rooms/room.events.js`, `socket/rooms/room.service.js`, `socket/users/user.events.js`, `socket/users/user.service.js`, `socket/chat/`, and `socket/gifts/`. Update this document whenever event names or payloads change.

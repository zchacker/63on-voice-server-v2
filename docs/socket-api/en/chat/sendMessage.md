# sendMessage

**Direction:** client to server.

## Input

Any non-null Socket.IO-serializable value. The server does not enforce a message schema. The socket must have joined a room.

    socket.emit("sendMessage", { "id": "msg-1", "text": "Hello" });

## Success output

Every socket in the room, including the sender, receives:

    { "message": <submitted value>, "user": <socket user> }

under the event name newMessage.

## Rejections

The sender receives messageRejected { code, message }:
- NOT_IN_ROOM: joinRoom has not succeeded.
- MESSAGES_LOCKED: ordinary user tried to write while locked.
- INVALID_MESSAGE: payload is null or undefined.

A valid moderator may still send messages while the room is locked. No callback acknowledgement is used.

## Source

socket/chat/chat.events.js; socket/chat/chat.service.js; socket/chat/chat.validation.js.

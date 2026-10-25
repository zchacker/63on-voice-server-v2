# leaveRoom

**Direction:** client to server.

## Input

No payload:

    socket.emit("leaveRoom");

## Output

There is no direct acknowledgement. The room receives:
- userList after the socket is removed.
- micUpdate only if a microphone spot was cleared.

The socket leaves the Socket.IO room. Its user and room fields are cleared. The user's temporary moderator role is removed when their last socket connection leaves the room. Fixed moderator roles and moderation flags remain in process memory.

Sending this event while not in a room is a no-op.

## Source

socket/users/user.events.js; socket/users/user.service.js; socket/rooms/room.service.js.

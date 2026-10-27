# disconnect (server lifecycle event)

**Direction:** Socket.IO server to the application; clients must not emit this event.

Socket.IO emits disconnect when the connection closes. The handler invokes the same room cleanup used by leaveRoom:
- Removes the socket from room state.
- Clears microphone spots owned by that user.
- Broadcasts userList and, if needed, micUpdate.
- Removes the temporary moderator role after the last socket for that user leaves.
- Posts an internal `left` presence notification to Laravel so it can update the database count.

There is no payload contract or acknowledgement. This is a lifecycle notification, not a client API request.

## Source

socket/users/user.events.js; socket/users/user.service.js; socket/rooms/room.service.js.

## LiveKit connection

This event cleans up Socket.IO state. It does not close a separate LiveKit connection. On intentional room exit, leave LiveKit through its SDK too. For interruptions, reconcile the connection states independently; see [LiveKit integration](../livekit.md).

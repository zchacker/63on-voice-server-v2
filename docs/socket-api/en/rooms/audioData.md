# audioData

**Legacy / unused by the application:** Audio now runs through LiveKit at livekit.63on.com, with a token from Laravel POST /api/room/join. Do not integrate this event for current audio. The contract below documents the handler still present in the source. See [LiveKit integration](../livekit.md).

**Direction:** client to server; raw Socket.IO payload.

## Input

Send any Socket.IO-serializable audio payload. The server does not define or validate an audio codec, frame format, or schema. The socket must have joined a room.

    socket.emit("audioData", audioPayload);

## Success output

Other sockets in the same room receive:

    { "userId": "user-42", "audio": audioPayload }

The sender does not receive its own broadcast.

## Rejections

audioDataRejected { code, message }:
- NOT_IN_ROOM if the socket has not joined.
- MIC_MUTED if the user's mic is currently muted.

## Behavior notes

This relay checks mute state but does not check that the user currently owns a microphone spot. Data is relayed only within the sender's current room.

## Source

socket/rooms/room.events.js; socket/rooms/room.service.js.

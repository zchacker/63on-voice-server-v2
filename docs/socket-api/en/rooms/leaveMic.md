# leaveMic

**Direction:** client to server.

## Input

This event coordinates the microphone seat only. Actual microphone publishing/unpublishing uses LiveKit SDK. See [LiveKit integration](../livekit.md).

    { "spotNumber": 2 }

spotNumber must be an integer from 0 through 7. The user must have joined a room and must own that spot by matching userId.

## Success outputs

- Requester receives leaveMic { spotNumber }.
- Room receives micUpdate after the spot is cleared.

## Rejections

micLeaveRejected { code, message }:
- NOT_IN_ROOM: no room/user is associated with this socket.
- INVALID_MIC_SPOT: spotNumber is not an integer in 0..7.
- MIC_SPOT_NOT_OWNED: the requested spot is empty or belongs to a different user.

Ownership is checked before the acknowledgement event is emitted. No Socket.IO acknowledgement callback is used.

## Source

socket/rooms/room.events.js; socket/rooms/room.service.js; socket/rooms/room.validation.js.

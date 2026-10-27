# requestMic

**Direction:** client to server.

## Input

This event coordinates the microphone seat only. Actual microphone publishing/unpublishing uses LiveKit SDK. See [LiveKit integration](../livekit.md).

    { "spotNumber": 2 }

spotNumber must be an integer from 0 through 7. The user must have joined a room.

## Success outputs

- Requester receives takeMic { spotNumber }.
- Room receives micUpdate with the spot assigned to the requesting user's object.

## Rejections

- micRequestRejected { code: "NOT_IN_ROOM", message } if the socket has not joined.
- micRequestRejected { code: "INVALID_MIC_SPOT", message } unless spotNumber is an integer 0..7.
- micRequestRejected { code: "MIC_MUTED", message } if a moderator has muted the user's mic.
- micRejected { code: "MIC_SPOT_TAKEN", message } if occupied. Current message text is Arabic: "تم أخذ المكان بالفعل".

## Behavior notes

There is no acknowledgement callback. The server does not prevent one user from holding multiple spots. A successful spot assignment is in-memory only.

## Source

socket/rooms/room.events.js; socket/rooms/room.service.js; socket/rooms/room.validation.js.

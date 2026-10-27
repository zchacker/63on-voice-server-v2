# LiveKit audio integration

## Responsibilities

Audio publishing, playback, subscriptions, and media transport use the existing LiveKit server at livekit.63on.com. The secure SDK connection address is wss://livekit.63on.com. Use the LiveKit SDK for the frontend platform.

Socket.IO handles room presence, user lists, microphone seats, chat, gifts, roles, and moderation notifications. requestMic and leaveMic coordinate seats; audioData and audioDataRejected are legacy events still present in the source and are not used by the current application audio flow.

## Two separate tokens

| Purpose | Laravel endpoint | Returned token | Frontend destination |
| --- | --- | --- | --- |
| Verified Socket.IO identity | POST /api/socket/session | socket_token | Socket.IO handshake auth.token |
| LiveKit room media access | POST /api/room/join | data.token | LiveKit SDK connection to wss://livekit.63on.com |

Both HTTP requests use Authorization: Bearer <sanctum-token>. Never exchange the two returned tokens or send server signing/service secrets to a frontend.

The Socket session response is direct JSON. The LiveKit endpoint uses Laravel's envelope: check both HTTP success and body.success before reading data.token.

## Room identifiers

The room model contains a database id and a username. Send the database ID as roomId to Socket.IO. The current Laravel LiveKit controller uses the submitted room_id verbatim as the LiveKit room name and compares it with rooms.username to identify the owner. Use the room's username for room_id in this existing LiveKit integration.

For a room with id 10 and username "1234567890123456":

    socket.emit("joinRoom", { roomId: "10" });

LiveKit token request:

    POST /api/room/join
    Authorization: Bearer <sanctum-token>
    Accept: application/json
    Content-Type: application/json

    { "room_id": "1234567890123456" }

Success response:

    {
      "success": true,
      "status": 200,
      "error": null,
      "data": {
        "user": { "userId": 42, "name": "Sara", "img": "..." },
        "permission": "user",
        "token": "<livekit-jwt>"
      }
    }

The documented current token lifetime is one hour. permission is admin for the owner matched by room username, otherwise user. Obtain the actual room object from Laravel; keep its id/username mapping together so Socket.IO and LiveKit participants refer to the same application room.

## Frontend sequence

1. Authenticate with Laravel/Sanctum.
2. Request /api/socket/session, connect Socket.IO with socket_token, and emit joinRoom with room.id.
3. Wait for Socket.IO join success, then request /api/room/join with room.username and connect the LiveKit SDK using data.token.
4. Listen through LiveKit subscriptions. On takeMic, enable/publish the local microphone through the LiveKit SDK.
5. On leaveMic or micMuted, disable/unpublish the local microphone through LiveKit. micUnmuted makes speaking eligible again; request a seat before publishing.
6. On kicked, leave both the Socket room UI and the LiveKit room. On an intentional exit, leave both services. Handle connection loss and reconnect state for each service separately.

Do not send audio frames through Socket.IO. Socket.IO and LiveKit connection states are separate: success in one does not establish a connection to the other.

## Current enforcement boundary

Node calls the LiveKit Server API to remove active participants on `banUser` and `removeUser`. It does not currently mute tracks or change publish grants for mic moderation; the frontend must still disable/unpublish its local mic on `micMuted`.

The current Laravel `/api/room/join` controller checks for an active persisted room ban and returns `USER_BANNED` before issuing a token. It does not check mic-seat eligibility or enforce a Socket mic mute at LiveKit. Socket participant removal also needs Laravel's `/authorize-join` response to include the trusted `room.liveKitRoomName` (`rooms.username`); the currently documented response omits that field.

## Sources

Owner-specified audio host: livekit.63on.com. Laravel API_REFERENCE.md and app/Http/Controllers/Api/Room/RoomsContoller.php (join_room). Node socket/rooms/room.events.js and room.service.js.

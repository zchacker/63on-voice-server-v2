# roomUpdated

Laravel calls the Socket server's internal update endpoint only after the room update is committed. Socket then broadcasts `roomUpdated` to active members of that canonical room.

## Laravel-to-Socket request

`POST /internal/socket/v1/rooms/{roomId}/updates`

Headers: `Authorization: Bearer <SOCKET_INTERNAL_SERVICE_TOKEN>` and `Content-Type: application/json`.

`roomId` is the canonical Laravel room database ID. The body contains only fields that changed:

```json
{
  "fields": {
    "title": "Room title",
    "image": "https://cdn.example.com/room.png",
    "country": {
      "id": "3",
      "name": "Saudi Arabia",
      "code": "SA",
      "imageUrl": "https://cdn.example.com/sa.png"
    },
    "description": "Public room description"
  }
}
```

`title` is a non-empty string up to 100 characters. `image` and `description` may be `null`; description is limited to 500 characters. `country` is either `null` or an object with exactly `id`, `name`, `code`, and `imageUrl`; `imageUrl` may be `null`. Unknown fields are rejected to keep internal data out of the broadcast.

The internal endpoint responds with `{ "success": true, "roomId": "10" }` after emitting. Invalid room/fields return HTTP 422; missing credentials return 401. It must be called after Laravel commits the update.

## Socket-to-frontend event

```json
{
  "roomId": "10",
  "title": "Room title",
  "image": "https://cdn.example.com/room.png"
}
```

Only changed public fields are present. The `country` object uses the shape above. No event is sent when Laravel's save fails because Laravel must not call the internal endpoint in that case.

## Source

`services/internal-http.service.js`, `socket/rooms/room.validation.js`, and `socket/rooms/room.service.js`.

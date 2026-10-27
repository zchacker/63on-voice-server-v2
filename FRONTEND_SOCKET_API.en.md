# Frontend Socket.IO API

Start with the [frontend integration guide](docs/socket-api/en/frontend-integration.md), then use the [API index](docs/socket-api/en/index.md) to open the separate specification for each event.

Each page lists the exact client payload, server output events, error codes, current behavior, and source files. Connection/JWT details are in [connection](docs/socket-api/en/connection.md), and all server-emitted events are listed in [server-events](docs/socket-api/en/server-events.md).

Room-list `online_count` is read from Laravel's room-list API and updated in the database from Node's internal join/leave notifications. There is no Socket.IO room-count subscription or count update event.

The Arabic reference is under docs/socket-api/ar/ and starts at [الفهرس العربي](docs/socket-api/ar/index.md).

These references describe the active code under socket/ and exclude demo/. Room joins and persistent moderation actions are authorized and stored through Laravel; Laravel also owns the persisted room-list online count. Temporary roles, mic seats, and other live state remain process-local.

The server emits `roomUpdated` to active room members after a successful Laravel room update. See [server events](docs/socket-api/en/server-events.md) and the [Laravel-to-Socket contract](docs/socket-api/en/rooms/roomUpdated.md).

Voice audio uses LiveKit at livekit.63on.com; Laravel POST /api/room/join returns its token. Read the [LiveKit guide](docs/socket-api/en/livekit.md). audioData is a legacy handler unused by the current application.

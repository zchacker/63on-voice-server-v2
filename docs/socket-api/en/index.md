# Socket.IO API Reference

This folder documents the active Socket.IO contract directly from the event handlers and their services under socket/. Demo code is excluded. Each client-emitted event has its own page.

- Audio: [LiveKit integration](livekit.md) — livekit.63on.com, token from Laravel POST /api/room/join. audioData is legacy and unused by the application.

## Connection and common rules

- Start with [frontend-integration.md](frontend-integration.md) for the full connection and room workflow.
- See connection.md for URL, handshake authentication, identity rules, and server configuration.
- This is Socket.IO, not raw WebSocket. The current server listens on PORT or 3000.
- The server does not use acknowledgement callbacks. Read each endpoint page for its events and error events.
- Joining a room is required before room-scoped events.
- See server-events.md for complete output event payloads.
- Each event page cites its implementation source.

## Room and user events

- rooms/joinRoom.md
- users/leaveRoom.md
- users/disconnect.md
- rooms/requestMic.md
- rooms/leaveMic.md
- rooms/roomUpdated.md

## Chat and gifts

- chat/sendMessage.md
- gifts/sendGift.md

## Moderation

- moderation/common.md
- moderation/banUser.md
- moderation/unbanUser.md
- moderation/removeUser.md
- moderation/promoteTemporaryModerator.md
- moderation/promoteFixedModerator.md
- moderation/demoteFixedModerator.md
- moderation/muteMic.md
- moderation/unmuteMic.md
- moderation/lockMessages.md
- moderation/unlockMessages.md

## Important implementation limits

- Laravel authorizes each room join and persists bans, fixed roles, mic mutes, and message locks.
- JWT is required to join. A connection may open without one, but joinRoom rejects it.
- Temporary roles and live socket state are process-local; multiple Node workers do not share live broadcasts.
- Gifts are broadcast only; no payment or balance validation is implemented.

## Legacy events retained in source

- [audioData](rooms/audioData.md): not used by the LiveKit audio flow.

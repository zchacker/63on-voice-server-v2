# Socket.IO API Reference

This folder documents the active Socket.IO contract directly from the event handlers and their services under socket/. Demo code is excluded. Each client-emitted event has its own page.

## Connection and common rules

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
- rooms/audioData.md

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
- moderation/muteMic.md
- moderation/unmuteMic.md
- moderation/lockMessages.md
- moderation/unlockMessages.md

## Important implementation limits

- Room access is not checked against Laravel or a database.
- State is process-local. Bans, moderator roles, mic mutes, and message locks are lost on server restart.
- JWT is optional for joining. Sessions without one can join as regular users with a client-supplied userId; such identities are not trusted for moderation.
- Gifts are broadcast only; no payment or balance validation is implemented.

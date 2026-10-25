# AI project context

Verified: 2026-10-25. Project root: /Users/hiramdiazdiaz/Documents/63on-voice-server-v2.
Read this file before inspecting source. Search symbols and open only files related to the task. Do not scan node_modules.

## Owner-defined module architecture
In each socket/<module>/ folder:
- *.events.js registers socket events and delegates.
- *.service.js executes the use case and sends responses/broadcasts.
- *.state.js owns that module's state.
- *.validation.js checks payloads, permissions, membership, ownership, and state-dependent eligibility.
Required flow: event -> service -> validation -> state mutation -> response. Services must enforce validation. Validation does not mutate state or emit events. Keep functions focused and avoid unnecessary layers. The owner permits Socket.IO responses from services.
Use the clean-code and clean-architecture skills for relevant work.

## Runtime
Node.js CommonJS and Socket.IO 4. npm start runs node server.js on PORT or 3000. Current entrypoint uses built-in HTTP and Socket.IO. Express, CORS and mediasoup are dependencies but not wired into the active entrypoint. No test script exists.
The server permits all CORS origins. socket/index.js installs optional JWT verification and registers room, chat, gift, user and moderation handlers.
demo/ is legacy reference only. services/laravel.service.js is not wired.

## Module map
- socket/auth/socket.auth.js: optional HS256 JWT verification from handshake.auth.token; token subject becomes socket.authenticatedUserId.
- socket/rooms/room.events.js and room.service.js: join/leave, microphone allocation and room-scoped audio forwarding.
- socket/rooms/room.state.js: liveRooms maps roomId -> Map(socketId,user); micSpots maps roomId -> spot-number object.
- socket/rooms/room.validation.js: join, room membership and spot-number validation.
- socket/users/: explicit leaveRoom and disconnect cleanup.
- socket/chat/: sendMessage with normal-user chat-lock enforcement.
- socket/gifts/: sendGift room broadcast.
- socket/moderation/: event registration, use cases/results, authorization rules and in-memory moderation state.
- services/laravel.service.js: empty placeholder; no Laravel API or persistence integration yet.

## Authentication and authorization
Set SOCKET_JWT_SECRET to verify HS256 JWTs; required claims include sub, optional exp and nbf are checked. Set SOCKET_ROOT_MODERATOR_IDS to comma-separated user IDs. A token subject overrides the client userId on room join.
Joining without a token is still allowed as an ordinary session. Moderation commands require the actor to have a valid JWT and an authorized room role. User-supplied userId values without a token are not trusted; do not rely on moderation against unauthenticated sessions. Send JWTs for every client to make identity-based moderation reliable.
Roles: root IDs from environment; fixed and temporary roles are assigned by moderation actions. Fixed roles survive room exit until process restart; temporary roles are removed after the user's last connection leaves the room. Root alone can promote fixed moderators. Fixed moderators can promote temporary moderators. Temporary moderators can ban/kick, mute/unmute microphones, and lock/unlock chat.

## Current socket API
Room/user events:
- joinRoom {roomId,user}: registers socket, broadcasts userList and micUpdate, sends roleUpdated and messageLockUpdated to joining client. Banned IDs receive joinRoomRejected.
- leaveRoom: explicit room leave and state cleanup; disconnect uses the same cleanup.
- requestMic {spotNumber}: integer range 0..7; muted users and occupied spots are rejected.
- leaveMic {spotNumber}: only spot owner can release it.
- audioData <payload>: relayed to other sockets in the same room as {userId:user.userId,audio}; muted user rejected.
- sendMessage <payload>: room gets newMessage {message,user}; normal users are rejected while chat is locked, moderators can send.
- sendGift <payload>: room gets sendGift {gift,user}; no balance/payment verification.
- removeUser {roomId,targetUserId,reason?}: moderator-only room kick without persistent ban.
Moderation commands all return moderationResult {action,success,code,message,roomId,targetUserId?,role?} to the actor:
- banUser {roomId,targetUserId,reason?}; unbanUser {roomId,targetUserId}
- promoteTemporaryModerator {roomId,targetUserId}; target must be present and authenticated
- promoteFixedModerator {roomId,targetUserId}
- muteMic / unmuteMic {roomId,targetUserId}
- lockMessages / unlockMessages {roomId}
The authoritative event-by-event references are in docs/socket-api/en/ and docs/socket-api/ar/. FRONTEND_SOCKET_API.md and FRONTEND_SOCKET_API.en.md are short entrypoints to those indexes. Keep the per-event pages synchronized with code.

## Moderation state and persistence
Bans, moderator roles, mic mutes and chat locks are held in socket/moderation/moderation.state.js maps/sets. They survive room exit as applicable but are lost on process restart and are not shared between multiple Node workers.
This module is the state boundary to replace with a Laravel-backed repository later. Do not claim database durability until that integration exists. Keep frontend event names and payloads stable when persistence is connected.

## Known limitations
- JWT is optional for room joins; non-token sessions can spoof client-supplied IDs and cannot safely be moderated. Production moderation should issue tokens to all users; global join enforcement was not added because it would block existing clients.
- Fixed moderators are permanent only for the current server process, not across restarts.
- There is no Laravel adapter/API, database persistence or multi-process state store yet.
- Gifts only broadcast client-supplied payloads.

## Project skills
Fourteen skills are installed in .agents/skills and ~/.codex/skills. Load only the relevant SKILL.md and its required mini guide.

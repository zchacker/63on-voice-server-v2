# AI project context

Verified: 2026-10-26. Project root: /Users/hiramdiazdiaz/Documents/63on-voice-server-v2.
Read this file before inspecting source. Search symbols and open only files related to the task. Do not scan node_modules.

## Owner-defined module architecture
In each socket/<module>/ folder:
- *.events.js registers Socket.IO events and delegates.
- *.service.js executes the event use case and sends its responses/broadcasts.
- *.state.js owns and stores that module's data.
- *.validation.js checks payload correctness, permissions, membership, ownership, and state-dependent eligibility.
Required flow: event -> service -> validation -> state mutation -> response. Services must enforce validation. Validation does not mutate state or emit events. Keep functions focused and avoid unnecessary layers. The owner permits Socket.IO responses from services.
Use the clean-code and clean-architecture skills for relevant work.

## Runtime
Node.js CommonJS and Socket.IO 4. npm start runs node server.js on PORT or 3000. server.js loads the project .env using Node's built-in loader when available. Express, CORS and mediasoup are dependencies but are not wired into the active entrypoint. npm test runs focused Node integration regression tests with mocked Laravel; no production credentials are used.
The server permits all CORS origins. socket/index.js installs JWT verification and registers room, chat, gift, user and moderation handlers.
demo/ is legacy reference only. services/laravel.service.js is the internal Laravel HTTP adapter.

## Module map
- socket/auth/socket.auth.js: verifies HS256 JWT handshake.auth.token, including sub, exp, iss, aud, and optional nbf.
- socket/rooms/: join authorization with Laravel, room membership and microphone seat allocation. Voice media is handled separately by LiveKit.
- socket/rooms/room.state.js: liveRooms maps roomId -> Map(socketId,user); micSpots maps roomId -> spot-number object.
- socket/users/: explicit leaveRoom and disconnect cleanup.
- socket/chat/: sendMessage with normal-user chat-lock enforcement.
- socket/gifts/: sendGift room broadcast; no payment validation.
- socket/moderation/: moderation events/use cases, validation and local mirror of persistent Laravel moderation state.
- services/laravel.service.js: internal POST requests to Laravel join authorization and moderation command endpoints. It reads server environment variables only and never logs secrets.

## Authentication and Laravel integration
Laravel issues the short-lived JWT through POST /api/socket/session after Sanctum authentication. Sanctum credentials are not accepted directly as Socket JWTs.
Node validates JWT HS256 signature using SOCKET_JWT_SECRET and checks typ=JWT, sub, exp, iss, aud, and optional nbf. Issuer/audience defaults are 63on-backend and 63on-socket; configure SOCKET_JWT_ISSUER and SOCKET_JWT_AUDIENCE in Node when Laravel overrides them.
Room joins require a verified JWT and a successful POST to Laravel /api/internal/socket/v1/rooms/{roomId}/authorize-join. Laravel supplies the trusted profile, persistent role, ban decision, mic mute and message-lock state. Node ignores client-supplied identity/profile/role fields and will not join if Laravel is unavailable or denies access.
SOCKET_JWT_SECRET and SOCKET_INTERNAL_SERVICE_TOKEN must each be at least 32 random characters, different from each other, and match Laravel's values. SOCKET_LARAVEL_API_BASE_URL is the Laravel origin without /api. The service token is sent only from Node to Laravel using Authorization: Bearer; never expose either secret to a frontend.

## Moderation and state ownership
Laravel is the durable source of truth for bans, fixed moderator roles, mic mutes and message locks. Node sends ban, unban, promote_fixed, demote_fixed, mute_mic, unmute_mic, lock_messages and unlock_messages commands with UUID requestId before changing its local mirror or broadcasting success. Laravel must return success=true and the same requestId; otherwise Node fails closed.
Temporary moderator promotion and removeUser/kick are live operations only. Temporary roles end when the target's last active room socket leaves. Live socket membership, mic spots, temporary roles and broadcasts remain process-local. Multiple Node workers do not share live broadcasts because no Socket.IO adapter is configured.
Room roles sent to the frontend are owner, root, fixed, temporary, or normal. Laravel saved-command authorization remains authoritative; SOCKET_ROOT_MODERATOR_IDS does not bypass its database role rules.
Keep docs/socket-api/en and docs/socket-api/ar synchronized with the Socket event contract. FRONTEND_SOCKET_API.md and FRONTEND_SOCKET_API.en.md are entrypoints.

## Project skills
Fourteen skills are installed in .agents/skills and ~/.codex/skills. Load only the relevant SKILL.md and its required mini guide.


## Join and concurrency guarantees
Client calls POST /api/socket/session with Sanctum, sends socket_token in handshake.auth.token, then emits joinRoom {roomId}. roomId accepts a nonempty string or positive safe integer; Node normalizes all membership/state to String(authorization.room.id). Client profile/role fields are ignored.
socket/rooms/room.state.js owns a shared per-room operation queue and versions. Join snapshots are reauthorized if a room operation completed during their HTTP request. Moderation uses the same queue. Keep both paths synchronized.
Saved commands retry transient failures up to three times with the identical UUID and payload. An unresolved outcome is retained in moderation.state.js; current members are removed and future entry must reconcile that UUID before fresh authorization. Never treat a timeout as proof that Laravel rolled back.
Capture actor identity before network awaits: confirmed persistent changes must still apply if the initiating socket leaves.


## Voice architecture (owner clarification)
Audio uses the existing LiveKit server livekit.63on.com (secure SDK URL wss://livekit.63on.com). Laravel POST /api/room/join issues the separate LiveKit token in data.token using Sanctum auth. POST /api/socket/session issues socket_token for Node identity only.
Node requestMic/leaveMic manage seats and emit events; frontend uses LiveKit SDK to publish/unpublish. audioData/audioDataRejected remain registered legacy handlers but the current application does not use them. Do not recommend Socket.IO audio streaming in frontend guides.
Current Laravel join_room uses room_id verbatim as LiveKit room name and tests owner against rooms.username: use room.username for LiveKit and room.id for Node, preserving their mapping.
Node does not call LiveKit server APIs; frontend must unpublish on micMuted/leaveMic and leave LiveKit on kicked. Laravel's current LiveKit token issuance does not enforce persisted bans or seat eligibility. Do not claim server-enforced LiveKit moderation until that integration exists.
Authoritative bilingual media guides: docs/socket-api/en/livekit.md and docs/socket-api/ar/livekit.md.

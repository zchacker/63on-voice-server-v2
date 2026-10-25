# AI project context

Verified: 2026-10-25. Working root: `/Users/hiramdiazdiaz/Documents/63on-voice-server-v2`.
Runtime sections describe current code; the owner-defined module architecture below is the required convention for future work. Update this file when behavior or conventions change.

## Read first / token budget
- Read this file first, then search relevant symbols and open only affected modules.
- Primary scope: `server.js`, `socket/`, `services/`.
- `demo/` is legacy and optional unless the task concerns old behavior. `demo/rooms.js` was checked when preparing this snapshot.
- Never scan `node_modules`, generated output, or every skill reference.
- Preserve existing architecture and event names unless a task requires changing them.

## Required module architecture (owner-defined)
Applies to all future work in `socket/<module>/`. Preserve this feature-based layout:
- `*.events.js`: Socket.IO event/endpoint registration and delegation; keep handlers thin.
- `*.service.js`: Execute the event use case and send its responses/broadcasts. Coordinate validation and state operations here.
- `*.state.js`: Own and store that module's data; expose focused access/update functions. Keep unrelated module data out.
- `*.validation.js`: Check payload correctness AND permission/eligibility to execute each action (identity, roles, membership, ownership, and relevant state conditions). Return explicit validation outcomes; do not mutate state or emit responses here.
Execution flow: event -> service -> validation -> state mutation -> response/broadcast. Validate before effects. Recheck state-sensitive rules at mutation time when asynchronous work can invalidate earlier checks.
Validation must be enforced by the service so another caller cannot bypass it by skipping the event adapter. Authentication may supply identity centrally; module authorization still belongs in module validation.
The owner explicitly permits service responses via Socket.IO; do not impose a full ports/adapters rewrite. If later needed, suggest incremental transport isolation while preserving these four responsibilities.
Use `clean-code` and `clean-architecture` for relevant implementation/design work; read their SKILL.md and required mini references. Prefer small focused functions and explicit boundaries over extra layers.
This is the intended convention, not a claim that all four files already exist in every module or that current code fully follows it. Create missing files when needed by the requested change; do not add empty scaffolding across the project.

## Runtime and architecture
Node.js CommonJS voice/chat signaling server using Socket.IO 4. `npm start` runs `node server.js`; `PORT` defaults to 3000. No test script exists.
Dependencies: socket.io, express, cors, mediasoup. Current entrypoint uses built-in HTTP and Socket.IO only; it exposes no Express REST routes and does not initialize mediasoup.
`server.js` creates the HTTP server, permits all CORS origins with GET/POST, calls `socket/index.js`, and listens.
`socket/index.js` registers room, chat, gift, and user handlers on each connection.
Each `*.events.js` registers events and delegates to `*.service.js`.

## File map
| File | Responsibility |
| --- | --- |
| `socket/rooms/room.events.js` | joinRoom, requestMic, leaveMic, audioData handlers |
| `socket/rooms/room.service.js` | Joining, mic allocation/release, audio forwarding |
| `socket/rooms/room.state.js` | Shared in-memory liveRooms/micSpots maps and getters |
| `socket/users/user.events.js` | removeUser and disconnect handlers |
| `socket/users/user.service.js` | Removal and disconnect cleanup |
| `socket/chat/chat.events.js`, `chat.service.js` | Message forwarding |
| `socket/gifts/gift.events.js`, `gift.service.js` | Gift forwarding |
| `socket/auth/socket.auth.js` | Empty placeholder; no active authentication |
| `socket/rooms/room.validation.js` | Empty placeholder; no active validation layer |
| `services/laravel.service.js` | Empty placeholder; no active Laravel integration |
| `demo/rooms.js` | Legacy monolithic Socket.IO server; reference only |

## State and identity
- `liveRooms`: Map<roomId, Set<JSON-stringified user>>. It is NOT a map of users keyed by userId.
- `micSpots`: Map<roomId, object keyed by spotNumber with user objects>.
- Joining stores `socket.roomId`, `socket.user`, and mutates user.socketId to socket.id.
- user.userId comes from client input. Audio output uses socket.id as userId instead.
- State is process-local and lost on restart; no database or shared multi-process store is wired up.

## Socket contract (current behavior)
| Incoming event / payload | Result |
| --- | --- |
| joinRoom `{roomId,user}` | Join Socket.IO room, add serialized user, broadcast userList array; broadcast micUpdate object if mic state exists |
| requestMic `{spotNumber}` | Requires socket room/user; rejects only numbers >7 and occupied slots; emits takeMic `{spotNumber}` to requester and micUpdate to room; occupied slot emits micRejected `{spotNumber,reason}` |
| leaveMic `{spotNumber}` | Emits leaveMic to requester; removes slot only if stored userId matches; broadcasts micUpdate after removal |
| audioData raw data | Broadcasts audioData `{userId:socket.id,audio:data}` to ALL other connected sockets |
| sendMessage arbitrary message | Room receives newMessage `{message,user:socket.user}` |
| sendGift arbitrary gift | Room receives sendGift `{gift,user:socket.user}` |
| removeUser `{roomId,targetUserId}` | Intended kick path is currently broken: calls .get on a Set; intended outputs kicked, userList, userRemoved |
| disconnect automatic | Removes matching userId from serialized set, clears matching mic slots 0..6, broadcasts micUpdate/userList |

## Known limitations to remember before edits
These were observed during reading, not fixed by this documentation task.
- removeUser assumes a Map while joinRoom creates a Set; nonempty existing room triggers TypeError on .get.
- audioData broadcasts globally rather than to the sender's room; no mic authorization check.
- Mic input lacks integer/lower-bound validation and does not enforce one slot per user. Slot 7 is accepted but disconnect cleans only 0..6.
- Auth/role checks and robust payload validation are absent. Destructured missing payloads can throw.
- Repeated joins can leave stale membership; no explicit leaveRoom event. Disconnect only handles last socket.roomId and first matching userId.
- Empty-room deletion on disconnect is commented out; mic maps are not removed there.
- leaveMic acknowledgement precedes ownership verification.
- Gifts are broadcasts only; no payment, balance, persistence, or backend verification exists in active code.

## Local skills
14 skills are already installed in `.agents/skills/<name>/SKILL.md`; `agent/skills/` contains matching source copies (formatting may differ), and `skills-lock.json` records upstream source/hashes.
Use the installed `.agents/skills` location. Select only skills relevant to the task, read their SKILL.md, then the referenced mini rules when instructed. Avoid loading all 14.
- Readability: clean-code, code-complete, the-pragmatic-programmer.
- Refactoring/legacy: refactoring, refactoring-guru, working-effectively-with-legacy-code.
- Architecture: clean-architecture, a-philosophy-of-software-design, patterns-of-enterprise-application-architecture.
- Domain modeling: domain-driven-design, domain-driven-design-distilled, implementing-domain-driven-design.
- Reliability/data: release-it, designing-data-intensive-applications.

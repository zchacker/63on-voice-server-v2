# Server-to-Client Events

The server emits these events. Payloads below reflect current code.

| Event | Recipient | Payload / behavior |
| --- | --- | --- |
| userList | Room | One entry per connected socket, including Laravel's trusted userId, name, avatar, and socketId. Client-supplied profile fields are ignored. |
| micUpdate | Room | Object keyed by mic spot number; values are assigned user objects. Empty object means no occupied spots. |
| roleUpdated | Joining/promoted user | { roomId, userId, role }; role is owner, root, fixed, temporary, or normal. |
| messageLockUpdated | Joining user or whole room | { roomId, locked, normalUsersOnly }; on join, normalUsersOnly equals locked. |
| micMuted | Target user | { roomId, userId }; also sent to a muted user on join. |
| micUnmuted | Target user | { roomId, userId }. |
| takeMic | Requesting user | { spotNumber }. |
| leaveMic | Releasing user | { spotNumber }. |
| micRejected | Requesting user | { code: "MIC_SPOT_TAKEN", message: string }. |
| micRequestRejected | Requesting user | { code, message }; examples NOT_IN_ROOM, INVALID_MIC_SPOT, MIC_MUTED. |
| micLeaveRejected | Requesting user | { code, message }; examples NOT_IN_ROOM, INVALID_MIC_SPOT, MIC_SPOT_NOT_OWNED. |
| audioData (legacy) | Other sockets in same room | { userId, audio }; userId is the application user ID, audio is the payload sent by the publisher. |
| audioDataRejected (legacy) | Sending user | { code, message }; NOT_IN_ROOM or MIC_MUTED. |
| newMessage | Room | { message, user }. |
| messageRejected | Sending user | { code, message }; NOT_IN_ROOM, MESSAGES_LOCKED, or INVALID_MESSAGE. |
| sendGift | Room | { gift, user }. |
| giftRejected | Sending user | { code: "NOT_IN_ROOM", message }. |
| joinRoomRejected | Joining user | { roomId, userId, code, message }; reports JWT, Laravel authorization, or configuration errors. |
| kicked | Removed target | { roomId, userId, reason }; reason may be null. |
| userBanned | Room | { roomId, userId }. |
| userUnbanned | Room | { roomId, userId }. |
| userRemoved | Room | { roomId, userId }. |
| moderatorUpdated | Room | { roomId, userId, role }. |
| micModerationUpdated | Room | { roomId, userId, muted }. |
| moderationResult | Requesting moderator | { action, success, code, message, roomId, targetUserId?, role?, state? }. state is included for persistent Laravel-backed actions. |

Socket.IO connection failures are delivered by Socket.IO itself as client event connect_error, not emitted by application event handlers.
There are no userJoined or userLeft application events.

## Source

All files under socket/**/events.js and the services they call.

Voice transport uses [LiveKit](livekit.md). The two audioData events above remain in the source for legacy reference and are unused by the current frontend. takeMic, leaveMic, micMuted, and kicked must be connected to the corresponding LiveKit SDK actions.

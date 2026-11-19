# Room controls: local authorization and versioned updates

Registered admission still requires a verified Socket JWT, successful Laravel `authorize-join`, and a validated internal `/policy` response with no `permissions.entry_error`. There is no anonymous admission or new room JWT contract. Socket token expiry/refresh is unchanged; another device signing in does not disconnect the existing session.

Node stores room settings once and user membership, persistent role, bans, mute flags/deadlines, and independent snapshot versions in process memory. Temporary moderator status remains owned by Node. Ordinary messages and microphone requests read this state synchronously, without calling Laravel or waiting for the room operation queue. There is **no periodic scan of participants**.

## Policy delivery contract

Laravel saves a `room_policy_events` outbox record in the same database transaction as each relevant settings, approved membership, sanction, fixed-role or message-lock change. After commit it posts the immutable snapshot to:

`POST /internal/socket/v1/rooms/{numericRoomId}/policy-refresh`

Authenticate with `Authorization: Bearer <SOCKET_INTERNAL_SERVICE_TOKEN>`. Laravel `SOCKET_NODE_BASE_URL` is the private Node origin without path. The payload is:

```json
{
  "version": "123",
  "room_id": "10",
  "livekit_room_name": "room-username",
  "suspended": false,
  "settings": {
    "members_only": false,
    "allow_anonymous_guests": true,
    "visitor_messages_allowed": true,
    "member_messages_allowed": true,
    "visitor_mic_allowed": true,
    "member_mic_allowed": true,
    "visitor_links_allowed": true,
    "message_max_length": null,
    "message_interval_seconds": null,
    "welcome_message": null,
    "rules": null
  },
  "messages_locked": false,
  "user": {
    "id": "42",
    "role": "normal",
    "is_member": false,
    "banned": false,
    "banned_until": null,
    "mic_muted": false,
    "mic_muted_until": null,
    "messages_muted": false,
    "messages_muted_until": null
  }
}
```

`user` is null for room-wide changes. Version is a decimal string. Node compares room settings and each user's version independently: a late event for user B is not suppressed by a newer unrelated event for user A. Duplicate/old snapshots cannot restore older cached privileges. Internal `/policy` adds this envelope as `data.snapshot` so join-time reads and pushed updates use the same version scheme. Saved moderation command responses add `policy` with the same event, allowing Node to apply the saved result without a refresh request. These are additive response fields.

Node returns HTTP 200 `{success:true,roomId,version}` after applying local state. This acknowledges local application, not LiveKit completion. Failed/missing/mismatched acknowledgements remain pending in Laravel. `socket:deliver-room-policy` retries up to 100 pending events per invocation, with retry delays from 5 to 300 seconds and no connected-user scan. The Laravel scheduler runs this command every minute; it must be enabled. Attempts may be duplicated; consumers are idempotent. The event table retains delivered versions as well as pending events; do not purge it without a revision watermark/retention design.

## Client behavior

`roomPolicyUpdated` is private to affected sockets and contains `{roomId,settings,permissions}`. The effective permissions include `entry_error,role,is_member,can_publish,can_message,direct_data_allowed,links_allowed,message_max_length,message_interval_seconds`. Welcome/rules are plain text. Existing microphone/role events remain supported.

`sendMessage` takes a non-empty string, at most 10,000 Unicode code points. Node enforces length, visitor links, room locks, role exemptions, message mutes and slow mode **locally** before `newMessage`. Failures emit `messageRejected` with `code,message` and optional integer `retry_after` seconds. Conventional URL detection is heuristic, as in Laravel. Slow mode is shared by all sockets of the user in the room and survives immediate reconnection until its deadline in this process; rejected validation does not reserve an interval. The old Laravel `/authorize-message` endpoint remains available for other callers, but Node no longer invokes it per message.

Changing `members_only` gates new admission. Existing visitors keep their admission and remain subject only to applicable message/mic restrictions, not a retroactive membership denial. Laravel's public policy/token APIs still apply their entry checks to new requests. A ban sends `kicked` before disconnect, removes room membership, and records registered departure with `leaveReason:ban`; LiveKit removal is queued independently. Temporary bans need no Node unban timer after disconnection: Laravel checks the current ban on re-entry. Temporary microphone/message mutes schedule a timer only for the affected connected user; at expiry Node recomputes local permissions with no Laravel call. Last temporary moderator departure also queues media privilege cleanup from cached facts.

## LiveKit and deployment

Only changed media rights trigger LiveKit work. Jobs are coalesced per participant, run with at most eight concurrent operations, and retry only failed operations with backoff. They do not occupy the room command/message queue. A newer desired state supersedes queued older work; active operations finish before newer work for the same participant. The adapter reads one participant rather than the full room list, and preserves unrelated grants including `hidden` and `recorder`. There is no trusted platform-observer admission contract yet.

Before enabling this release:

1. Apply `database/migrations/2026_11_15_000006_create_room_policy_events_table.php` in Laravel after the preceding room-control migrations. No migrations were run against a real database during development.
2. Configure `SOCKET_NODE_BASE_URL` and matching distinct internal/JWT secrets; enable Laravel scheduler (`php artisan schedule:work` or the normal `schedule:run` cron). Blank origin keeps events pending. Verify `php artisan socket:deliver-room-policy` and inspect pending delivery failures.
3. Deploy both projects together. Node requires the new `/policy` snapshot fields. The previous empty-body 202 callback contract is replaced by versioned snapshots and HTTP 200 acknowledgements.
4. Test real Laravel/Node/LiveKit integration under realistic room sizes and reconnects. No million-connection capacity claim is made by these changes.

Known boundaries: room state and slow-mode reservations remain single-process, as requested; multiple Node processes need room ownership/shared state and notification fanout before horizontal scaling. Media retry jobs are in memory and do not survive a process restart; fresh admissions resynchronize connected users. New LiveKit token TTL remains 600 seconds; old tokens are not revoked. Self-hosted LiveKit can accept an older token after removal. Coordinate legacy-token drainage and add trusted LiveKit participant-join enforcement for direct/old-token clients before claiming instantaneous production-wide bans. A Node crash still has no presence heartbeat to close old visits. Anonymous visits and trusted hidden platform observer admission remain deferred.

Owner, fixed moderators and verified temporary moderators bypass the room-specific message length, slow mode, group message restrictions and visitor link filtering. The global 10,000-code-point input limit still applies.

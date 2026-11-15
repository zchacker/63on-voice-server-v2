# Room controls integration

Node still requires a registered Socket JWT and a successful Laravel `authorize-join`. Client identity/profile/role fields remain untrusted. Before completing admission Node also reads the internal `/policy` and rejects a non-null `permissions.entry_error`, even with HTTP 200. Temporary moderator status comes exclusively from Node's room state.

`sendMessage` accepts a non-empty string up to 10,000 Unicode characters. Every broadcast calls Laravel `/authorize-message`; only boolean `allowed: true` permits `newMessage`. Existing `messageRejected` gains optional integer `retry_after` (seconds). Denials preserve Laravel's code, including `MESSAGES_DISABLED`, `LINKS_DISABLED`, `MESSAGE_TOO_LONG`, `SLOW_MODE`, and entry denial codes. Network failures deny the message. Authorization reserves Laravel's interval; messages are not automatically retried.

`roomPolicyUpdated` is sent privately to the affected socket on admission and when settings/effective permissions change:

```json
{"roomId":"10","settings":{},"permissions":{"entry_error":null,"role":"normal","can_publish":true,"can_message":true,"direct_data_allowed":true}}
```

The real permissions object also includes membership, links, length, and interval fields from Laravel. Welcome/rules are plain text. Existing mic events remain supported; `requestMic` checks current Laravel policy before reserving a seat. Restrictive entry settings do not themselves kick existing visitors; their effective media/message permissions still come from Laravel. Ban removes Socket membership, disconnects the connection, removes the LiveKit participant, and reports `leaveReason: ban`. Registered visits continue through `/presence`, including explicit leave/disconnect/kick/ban reasons.

## Synchronization

Configure Laravel `SOCKET_NODE_BASE_URL` to this Node origin. After committing settings, approved membership changes, sanctions, locks, or fixed roles, Laravel POSTs `{}` to:

`/internal/socket/v1/rooms/{canonicalNumericRoomId}/policy-refresh`

Use `Authorization: Bearer <SOCKET_INTERNAL_SERVICE_TOKEN>`. The endpoint accepts no client identities, permissions, or room names. HTTP 202 acknowledges scheduling, not successful LiveKit convergence; failures are logged and retried by periodic reconciliation. Immediate acknowledgement avoids deadlock when Node is waiting for a Laravel moderation command. Laravel limits notification delivery to two seconds; failures never roll back committed data. No extra queue worker is required.

Node reads fresh policies under the existing room operation queue, updates active Socket participants and LiveKit `canPublish`/`canPublishData`, and preserves other LiveKit permissions including `hidden` and `recorder`. Expiry refreshes use the additive `/policy` field `data.next_change_at` (ISO timestamp or null). A one-minute fallback repairs missed notifications and failed refreshes. It runs without overlap and emits client policy events only when policy changes. Failed LiveKit ban removals are retained in memory and retried after checking that the ban is still active. Temporary role removal on the last Socket departure also refreshes the detached LiveKit participant.

## Deployment boundary

1. Deploy the Laravel policy endpoints and Node integration together; set the private Node origin and matching distinct service/JWT secrets. Keep notification ingress private and authenticated.
2. Use a shared atomic Laravel cache (database/Redis) for slow mode. The existing Node room/temporary-role state is single-process. For multiple Node instances, deliver notifications to every instance; a load-balanced callback to one worker is insufficient.
3. Verify joins/denials, messages and retry seconds, REST settings/membership changes, all sanctions/roles, expiry, two concurrent sockets, and LiveKit publish/data revocation on staging with the real server.
4. New Laravel LiveKit tokens last 600 seconds. Previously issued tokens are unchanged. On self-hosted LiveKit, removal/permission changes do not invalidate old tokens. Before enabling restrictive production settings, stop issuing old grants, coordinate disconnection/re-entry of existing participants, and wait out the longest previously issued TTL (the previous application default was one hour), or use a separately approved server/key revocation plan. Short TTL alone does not provide instant revocation.
5. This synchronization covers participants tracked by Socket and temporary-role departure cleanup. A client that connects only to LiveKit, or rejoins using an old LiveKit token without Socket, requires a trusted LiveKit participant-join webhook/admission integration for immediate enforcement. Do not claim production-wide instantaneous restrictions until this is tested and integrated.

Anonymous Socket entry remains disabled. If introduced later, first define trusted admission and a stable server-issued identity matching LiveKit, then use `/guest-visits` with one immutable visit UUID and original join timestamp for entry/departure/retries; never duplicate registered presence as guest visits.

There is no trusted platform-observer role yet. No client `hidden`/`admin` field enables it. Existing LiveKit hidden permissions are preserved; future observer admission, private audit, count/visit exclusion, and listen-only grants require a separate trusted Laravel contract.

Known operational limits: fallback latency may exceed one minute during upstream outages/large room batches; pending LiveKit removals and expiry timers are process-local and do not survive restart. A Node crash still has no visit-closing heartbeat. Monitor synchronization failure logs before enabling production restrictions.

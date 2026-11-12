# refreshSocketSession

**Direction:** client to server on an authenticated, connected Socket.IO session.

## Input

```js
socket.emit('refreshSocketSession', { token: newSocketToken });
```

`token` is the new `socket_token` returned by Laravel `POST /api/socket/session` using the current user's Sanctum authentication. The frontend requests it while the existing Socket session is still valid. The new JWT must pass the same signature and claim checks as the initial handshake, have the same `sub`, and expire later than the currently accepted JWT. JWT lifetime remains at most 600 seconds.

## Success output

Only the requesting socket receives `socketSessionRefreshed`.

```json
{
  "userId": "42",
  "expiresAt": 1800000190,
  "expiresIn": 180
}
```

`expiresAt` is the accepted JWT `exp`, a Unix timestamp in seconds. `expiresIn` is the remaining whole seconds at confirmation time. Use this confirmation to schedule the next renewal about 60 seconds before expiry.

The server replaces the expiry timer on the current connection. The socket ID, room membership, microphone seat, temporary moderator role, and LiveKit connection continue through a successful refresh. Refresh only renews identity validity. Existing room authorization and moderation rules still apply.

## Failure output

The requesting socket receives `socketSessionRefreshRejected`.

```json
{
  "code": "SESSION_IDENTITY_MISMATCH",
  "message": "The new token must belong to the current user."
}
```

| Code | Meaning |
| --- | --- |
| AUTHENTICATION_REQUIRED | The connection has no active authenticated session. Connect with a valid handshake token. |
| INVALID_REFRESH_PAYLOAD | Send an object with a non-empty `token` string. |
| INVALID_SOCKET_TOKEN | Signature or JWT claims are invalid, or the new token has expired. |
| SESSION_IDENTITY_MISMATCH | The token belongs to another user. |
| SESSION_NOT_EXTENDED | The new `exp` is equal to or earlier than the currently accepted expiry. This also rejects repeated or late older refresh requests. |

A rejected refresh preserves the current claims and expiry timer. Retry with a valid newer token before that timer expires. Packets arriving after the current session expires are blocked by the authentication middleware, and the server disconnects. An expired connection must establish a fresh connection and join its room again.

## Frontend example

Register response listeners once before sending requests. Keep one refresh request in flight at a time because responses have no request ID or acknowledgement callback.

```js
socket.on('socketSessionRefreshed', ({ expiresAt, expiresIn }) => {
  // Schedule the next call to renewSocketSession about 60 seconds before expiry.
  onSessionRenewed({ expiresAt, expiresIn });
});

socket.on('socketSessionRefreshRejected', ({ code, message }) => {
  onSessionRenewalError({ code, message });
});

async function renewSocketSession() {
  const response = await fetch(laravelOrigin + '/api/socket/session', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + sanctumToken,
      Accept: 'application/json'
    }
  });
  if (!response.ok) throw new Error('Socket token renewal failed.');
  const session = await response.json();
  socket.auth = { ...socket.auth, token: session.socket_token };
  if (socket.connected) {
    socket.emit('refreshSocketSession', { token: session.socket_token });
  } else {
    socket.connect();
  }
}
```

`onSessionRenewed` and `onSessionRenewalError` are frontend integration callbacks. Initially schedule renewal from Laravel's `expires_in`. After acceptance, schedule from `expiresIn`. Updating `socket.auth` prepares the next handshake, while emitting `refreshSocketSession` renews the active session. Call `joinRoom` in the normal `connect` handler when an actual reconnection occurs.

Catch HTTP errors and handle a missing Socket confirmation with a bounded timeout. Retry while the old session is valid. Clear renewal timers on disconnect or logout and prevent concurrent renewal calls. Background timer delays or network failure can still let the current token expire. Laravel's existing issuer route and server secrets are reused.

## Source

`socket/auth/auth.events.js`, `auth.service.js`, `auth.validation.js`, `auth.state.js`, and `socket.auth.js`.

# Socket Connection and Authentication

## Connect

Use the deployed HTTP(S) origin. The default port is 3000; PORT overrides it. Socket.IO handles transport negotiation.

    import { io } from "socket.io-client";
    const socket = io("https://<SOCKET_HOST>", {
      auth: { token: socketJwt }
    });

## Obtain the Socket JWT from Laravel

After Laravel login, call POST /api/socket/session with the user's Sanctum authentication. Laravel returns a short-lived socket_token. A Sanctum token is not itself a JWT and must not be sent as the Socket token.

The Socket handshake sends the returned JWT in auth.token. Node verifies:
- JWT header alg=HS256 and typ=JWT.
- HMAC-SHA256 signature with SOCKET_JWT_SECRET.
- A non-empty string sub.
- Integer iat and exp Unix timestamps in seconds, plus a non-empty jti.
- A future exp Unix timestamp in seconds.
- iss and aud, which default to 63on-backend and 63on-socket. Set SOCKET_JWT_ISSUER and SOCKET_JWT_AUDIENCE on Node if Laravel uses different configured values.
- nbf when present.

A token with an invalid signature or claims rejects the connection with connect_error beginning AUTHENTICATION_FAILED. The server disconnects the socket at exp and rejects further events after expiry. A connection without a token may open, but it cannot join any room.

## Join identity and authorization

The client emits joinRoom with roomId. Legacy user data may still be included for compatibility, but the server ignores it. Node takes the user ID from the verified JWT sub, then calls Laravel POST /api/internal/socket/v1/rooms/{roomId}/authorize-join using its server-only service token. A room is joined only after Laravel returns allowed=true and a user ID matching the JWT subject.

Laravel supplies the trusted user profile, persistent role, ban status, microphone mute status, and room message-lock state. Client-supplied userId, role, isModerator, and permissions never grant identity or access.

## Server environment

Set these on the Node server:
- SOCKET_JWT_SECRET: same value as Laravel, at least 32 random characters.
- SOCKET_INTERNAL_SERVICE_TOKEN: same value as Laravel's service token, different from the JWT secret, at least 32 random characters.
- SOCKET_LARAVEL_API_BASE_URL: Laravel origin only, for example https://api.example.com. Do not add /api.
- SOCKET_JWT_ISSUER and SOCKET_JWT_AUDIENCE: same as Laravel; defaults are shown above.
- SOCKET_LARAVEL_REQUEST_TIMEOUT_MS: optional, default 5000; valid range 100–30000.

The Socket server loads the project .env file using Node's built-in environment-file loader when available. Keep .env out of source control. Never send either secret to a mobile or web client. The example keys are in .env.example.

SOCKET_ROOT_MODERATOR_IDS is a comma-separated list of local root user IDs. A root ID does not bypass Laravel's persisted authorization: Laravel still must recognize the actor as the room owner, a fixed moderator, or a permitted temporary moderator for a saved moderation command.

## Source

socket/auth/socket.auth.js; socket/rooms/room.service.js; socket/rooms/room.validation.js; services/laravel.service.js.

## Separate voice connection

LiveKit at wss://livekit.63on.com carries voice. Its token comes from Laravel POST /api/room/join (data.token), not /api/socket/session. See [LiveKit integration](livekit.md).

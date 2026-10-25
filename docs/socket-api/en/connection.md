# Socket Connection and Authentication

## Connect

Use the deployed HTTP(S) origin. The default port is 3000; PORT overrides it. Socket.IO handles its own transport negotiation.

    import { io } from "socket.io-client";
    const socket = io("https://<HOST>");

## Optional JWT handshake

The client may send a JWT through handshake auth:

    const socket = io("https://<HOST>", {
      auth: { token: "<JWT>" }
    });

When a token is supplied, the server requires a valid JWT with:
- Header alg equal to HS256.
- A valid HMAC-SHA256 signature using server environment variable SOCKET_JWT_SECRET.
- A non-empty string sub claim, used as authenticatedUserId.
- Optional exp and nbf claims are checked as Unix seconds when truthy.

An invalid supplied token rejects the Socket.IO connection and the client receives connect_error with an AUTHENTICATION_FAILED message. No token is currently allowed; the connection then has no authenticatedUserId.

## Identity on join

The client still sends joinRoom with a user object. With a valid JWT, the server replaces user.userId with JWT sub. Without a JWT, user.userId must be a non-empty string and is client supplied, so it can be spoofed. The server removes client fields role, isModerator, and permissions before broadcasting the user.

Only a valid authenticated identity can have root, fixed, or temporary moderator privileges. Root user IDs come from comma-separated SOCKET_ROOT_MODERATOR_IDS. The JWT itself does not grant a role.

## Current trust boundary

JWT is optional for room join. Do not rely on bans or mic mutes for an unauthenticated session: such a client can claim another userId. A future Laravel integration should exchange/validate the Sanctum credential and enforce room membership before joinRoom succeeds.

## Source

socket/auth/socket.auth.js; socket/index.js.

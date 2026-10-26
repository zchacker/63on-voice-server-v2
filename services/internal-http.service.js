const crypto = require('crypto');
const express = require('express');
const roomValidation = require('../socket/rooms/room.validation');
const roomService = require('../socket/rooms/room.service');

function matchesServiceCredential(request) {
    const expected = process.env.SOCKET_INTERNAL_SERVICE_TOKEN || '';
    const jwtSecret = process.env.SOCKET_JWT_SECRET || '';
    if (expected.length < 32 || expected === jwtSecret) return null;

    const authorization = request.get('Authorization') || '';
    const supplied = authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : '';
    const expectedBytes = Buffer.from(expected);
    const suppliedBytes = Buffer.from(supplied);
    return expectedBytes.length === suppliedBytes.length
        && crypto.timingSafeEqual(expectedBytes, suppliedBytes);
}

function registerInternalHttpRoutes(app, io) {
    app.post(
        '/internal/socket/v1/rooms/:roomId/updates',
        express.json({ limit: '8kb' }),
        (request, response) => {
            const authorized = matchesServiceCredential(request);
            if (authorized === null) {
                return response.status(503).json({
                    success: false,
                    code: 'SOCKET_CONFIGURATION_INVALID',
                    message: 'The internal Socket service credential is not configured.'
                });
            }
            if (!authorized) {
                return response.status(401).json({
                    success: false,
                    code: 'SOCKET_SERVICE_AUTH_FAILED',
                    message: 'A valid internal service credential is required.'
                });
            }

            const roomId = request.params.roomId;
            if (!/^[1-9][0-9]*$/.test(roomId)) {
                return response.status(422).json({
                    success: false,
                    code: 'INVALID_ROOM_ID',
                    message: 'roomId must be the canonical Laravel room ID.'
                });
            }
            if (!request.body || typeof request.body !== 'object'
                || Array.isArray(request.body)
                || Object.keys(request.body).some((key) => key !== 'fields')) {
                return response.status(422).json({
                    success: false,
                    code: 'INVALID_ROOM_UPDATE',
                    message: 'The request must contain only the public fields object.'
                });
            }

            const checked = roomValidation.validateRoomUpdateFields(request.body.fields);
            if (!checked.valid) {
                return response.status(422).json({
                    success: false,
                    code: checked.code,
                    message: checked.message
                });
            }

            roomService.broadcastRoomUpdated(io, roomId, checked.fields);
            return response.status(200).json({ success: true, roomId });
        }
    );
}

module.exports = { registerInternalHttpRoutes };

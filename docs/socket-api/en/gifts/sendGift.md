# sendGift

**Direction:** client to server.

## Input

Any Socket.IO payload agreed by the frontend and product. No gift schema is enforced. The socket must have joined a room.

    socket.emit("sendGift", { "id": "gift-1", "name": "Rose" });

## Success output

Every socket in the room, including sender, receives:

    { "gift": <submitted value>, "user": <socket user> }

under event sendGift.

## Rejection

The sender receives giftRejected { code: "NOT_IN_ROOM", message } if not joined.

## Important limitation

This is a broadcast only. The server does not check gift availability, ownership, price, payment, or balance, and does not persist gifts.

## Source

socket/gifts/gift.events.js; socket/gifts/gift.service.js.

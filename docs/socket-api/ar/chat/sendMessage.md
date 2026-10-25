# sendMessage

**الاتجاه:** من العميل إلى الخادم.

## الإدخال

أي قيمة غير null يقبلها Socket.IO. لا يفرض الخادم مخططًا ثابتًا للرسالة. يجب أن يكون socket قد انضم لغرفة.

    socket.emit("sendMessage", { "id": "msg-1", "text": "Hello" });

## مخرج النجاح

تستقبل جميع sockets في الغرفة، بما فيها المرسل:

    { "message": <القيمة المرسلة>, "user": <مستخدم هذا socket> }

ضمن الحدث newMessage.

## الرفض

يستقبل المرسل messageRejected { code, message }:
- NOT_IN_ROOM: لم ينجح joinRoom.
- MESSAGES_LOCKED: مستخدم عادي حاول الإرسال أثناء القفل.
- INVALID_MESSAGE: الحمولة null أو undefined.

يستطيع المشرف الموثق الإرسال أثناء القفل. لا يستخدم الحدث callback للإقرار.

## المصدر

socket/chat/chat.events.js وchat.service.js وchat.validation.js.

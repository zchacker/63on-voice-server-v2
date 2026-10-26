# audioData

**قديم وغير مستخدم في التطبيق:** يعمل الصوت الآن عبر LiveKit على livekit.63on.com بتوكن من Laravel POST /api/room/join. لا تستخدموا هذا الحدث للصوت الحالي. يوثق ما يلي handler الذي ما زال موجودًا في المصدر. راجعوا [دليل LiveKit](../livekit.md).

**الاتجاه:** من العميل إلى الخادم؛ ترسل حمولة Socket.IO مباشرة.

## الإدخال

أرسل أي حمولة يقبلها Socket.IO. لا يحدد الخادم codec أو تنسيق إطار صوتي أو schema للبيانات. يجب أن يكون socket منضمًا لغرفة.

    socket.emit("audioData", audioPayload);

## مخرج النجاح

تستقبل بقية sockets في الغرفة نفسها:

    { "userId": "user-42", "audio": audioPayload }

لا يستقبل المرسل بثه الخاص.

## الرفض

يرسل audioDataRejected { code, message }:
- NOT_IN_ROOM إذا لم ينضم socket.
- MIC_MUTED إذا كان المستخدم مكتومًا.

## ملاحظات

يتحقق الخادم من حالة الكتم لكنه لا يتحقق من أن المستخدم يملك مقعد مايك حاليًا. يقتصر البث على غرفة المرسل.

## المصدر

socket/rooms/room.events.js وroom.service.js.

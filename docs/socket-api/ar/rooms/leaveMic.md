# leaveMic

**الاتجاه:** من العميل إلى الخادم.

## الإدخال

    { "spotNumber": 2 }

يجب أن يكون spotNumber عددًا صحيحًا من 0 إلى 7. يجب أن يكون المستخدم منضمًا للغرفة ومالكًا للمقعد وفق تطابق userId.

## المخرجات عند النجاح

- صاحب الطلب يستقبل leaveMic { spotNumber }.
- الغرفة تستقبل micUpdate بعد إخلاء المقعد.

## الرفض

يرسل micLeaveRejected { code, message }:
- NOT_IN_ROOM: لا توجد غرفة أو هوية مستخدم مرتبطة بهذا socket.
- INVALID_MIC_SPOT: الرقم ليس عددًا صحيحًا بين 0 و7.
- MIC_SPOT_NOT_OWNED: المقعد فارغ أو يخص مستخدمًا آخر.

يتحقق الخادم من الملكية قبل إرسال إقرار الحدث. لا يوجد Socket.IO acknowledgement.

## المصدر

socket/rooms/room.events.js وroom.service.js وroom.validation.js.

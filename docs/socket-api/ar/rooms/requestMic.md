# requestMic

**الاتجاه:** من العميل إلى الخادم.

## الإدخال

ينسق هذا الحدث مقعد المايك فقط. يتم نشر المايك وإيقافه عبر LiveKit SDK. راجعوا [دليل LiveKit](../livekit.md).

    { "spotNumber": 2 }

يجب أن يكون spotNumber عددًا صحيحًا من 0 إلى 7، وأن يكون المستخدم منضمًا إلى غرفة.

## المخرجات عند النجاح

- طالب المايك يستقبل takeMic { spotNumber }.
- الغرفة تستقبل micUpdate مع المقعد المحجوز لكائن المستخدم.

## الرفض

- micRequestRejected { code: "NOT_IN_ROOM", message } إذا لم ينضم socket.
- micRequestRejected { code: "INVALID_MIC_SPOT", message } إذا لم يكن رقمًا صحيحًا بين 0 و7.
- micRequestRejected { code: "MIC_MUTED", message } إذا كان المشرف قد كتم المايك.
- micRejected { code: "MIC_SPOT_TAKEN", message } إذا كان المقعد محجوزًا. نص الرسالة الحالي: "تم أخذ المكان بالفعل".

## ملاحظات

لا يوجد acknowledgement. لا يمنع الخادم المستخدم من حجز عدة مقاعد. الحجز محفوظ في الذاكرة فقط.

## المصدر

socket/rooms/room.events.js وroom.service.js وroom.validation.js.

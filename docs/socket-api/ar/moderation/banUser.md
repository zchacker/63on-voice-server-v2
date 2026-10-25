# banUser

**الاتجاه:** من مشرف الواجهة إلى الخادم.

## الإدخال

    { "roomId": "room-123", "targetUserId": "user-42", "reason": "Spam" }

يجب أن يكون roomId وtargetUserId نصين غير فارغين. reason اختياري، ويحفظ بحد أقصى 300 حرف.

## مخرجات النجاح

- يستقبل المنفذ moderationResult مع action=banUser وsuccess=true.
- تستقبل اتصالات الهدف النشطة kicked { roomId, userId, reason } وتغادر الغرفة وتفقد مقاعد المايك.
- تستقبل الغرفة userBanned { roomId, userId } وuserList وmicUpdate.
- يرفض joinRoom اللاحق إذا استخدم userId نفسه بسبب USER_BANNED.

يحفظ الحظر حتى إذا لم يكن للهدف اتصال نشط.

## التحقق والأخطاء

يجب أن يكون المنفذ موثقًا ومنضمًا للغرفة وذا رتبة كافية. الأخطاء تعاد في moderationResult، مثل INVALID_ROOM_ID وNOT_IN_ROOM وINVALID_TARGET_USER_ID وFORBIDDEN وSELF_TARGET وINSUFFICIENT_ROLE.

## حد الثقة

هوية الهدف مرتبطة بـsub عند استخدام JWT. يستطيع عميل بلا JWT ادعاء userId مختلف، لذلك الحظر غير موثوق ضد الجلسات غير الموثقة.

## المصدر

socket/moderation/moderation.events.js وmoderation.service.js وmoderation.validation.js وmoderation.state.js.

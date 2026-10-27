# banUser

**الاتجاه:** من مشرف الواجهة إلى الخادم.

## الإدخال

    { "roomId": "room-123", "targetUserId": "user-42", "reason": "Spam" }

يجب أن يكون roomId وtargetUserId نصين غير فارغين. reason اختياري؛ يقصه Node إلى 1000 حرف ليتوافق مع عقد أوامر Laravel.

## مخرجات النجاح

- يستقبل المنفذ moderationResult مع action=banUser وsuccess=true.
- بعد إزالة عضوية Socket، تستقبل اتصالات الهدف النشطة kicked { roomId, userId, reason } وتفقد مقاعد المايك.
- تستقبل الغرفة userBanned { roomId, userId } وuserList وmicUpdate.
- يرفض joinRoom اللاحق إذا استخدم userId نفسه بسبب USER_BANNED.

يحفظ Laravel الحظر حتى إذا لم يكن للهدف اتصال نشط. لا يحتفظ Node بنسخة من قائمة المحظورين؛ ويستخدم `state.banned` المعادة من Laravel. بعد تأكيد Laravel للحظر، يزيل Node مشارك LiveKit النشط وينهي عضوية Socket ويرسل userBanned بحمولته الحالية. إذا فشلت عملية LiveKit، تعود moderationResult فاشلة رغم بقاء الحظر الدائم محفوظًا. يجب أن يرفض Laravel إصدار توكن LiveKit للمحظور؛ وما زال هذا الفحص مطلوبًا في نسخة Laravel التي راجعناها.

## التحقق والأخطاء

يجب أن يكون المنفذ موثقًا ومنضمًا للغرفة وذا رتبة كافية. الأخطاء تعاد في moderationResult، مثل INVALID_ROOM_ID وNOT_IN_ROOM وINVALID_TARGET_USER_ID وFORBIDDEN وSELF_TARGET وINSUFFICIENT_ROLE.

## المصدر

socket/moderation/moderation.events.js وmoderation.service.js وmoderation.validation.js وmoderation.state.js.

## الصوت عبر LiveKit

يزيل Node المشارك النشط من LiveKit Server API. وعلى الواجهة مغادرة غرفة LiveKit المحلية بعد وصول `kicked`. راجعوا [دليل LiveKit](../livekit.md).

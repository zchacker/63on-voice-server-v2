# banUser

**الاتجاه:** من مشرف الواجهة إلى الخادم.

## الإدخال

    { "roomId": "room-123", "targetUserId": "user-42", "reason": "Spam" }

يجب أن يكون roomId وtargetUserId نصين غير فارغين. reason اختياري؛ يقصه Node إلى 1000 حرف ليتوافق مع عقد أوامر Laravel.

## مخرجات النجاح

- يستقبل المنفذ moderationResult مع action=banUser وsuccess=true.
- تستقبل اتصالات الهدف النشطة kicked { roomId, userId, reason } وتغادر الغرفة وتفقد مقاعد المايك.
- تستقبل الغرفة userBanned { roomId, userId } وuserList وmicUpdate.
- يرفض joinRoom اللاحق إذا استخدم userId نفسه بسبب USER_BANNED.

يحفظ Laravel الحظر حتى إذا لم يكن للهدف اتصال نشط. لا يغير Node حالته المحلية ولا يبث النجاح إلا بعد تأكيد Laravel.

## التحقق والأخطاء

يجب أن يكون المنفذ موثقًا ومنضمًا للغرفة وذا رتبة كافية. الأخطاء تعاد في moderationResult، مثل INVALID_ROOM_ID وNOT_IN_ROOM وINVALID_TARGET_USER_ID وFORBIDDEN وSELF_TARGET وINSUFFICIENT_ROLE.

## المصدر

socket/moderation/moderation.events.js وmoderation.service.js وmoderation.validation.js وmoderation.state.js.

## الصوت عبر LiveKit

نفذوا تغيرات المايك ومغادرة المشاركين عبر LiveKit SDK كما يوضح [دليل LiveKit](../livekit.md). لا تغير أوامر Socket.IO صلاحيات LiveKit ولا تفصل مشاركيه مباشرة من الخادم.

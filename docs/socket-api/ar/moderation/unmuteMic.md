# unmuteMic

**الاتجاه:** من مشرف الواجهة إلى الخادم.

## الإدخال

    { "roomId": "room-123", "targetUserId": "user-42" }

يمكن أن يكون الهدف غير متصل. يجب أن يكون المنفذ مشرفًا موثقًا داخل الغرفة.

## مخرجات النجاح

- يستقبل المنفذ moderationResult ناجحًا.
- تستقبل اتصالات الهدف النشطة micUnmuted { roomId, userId }.
- تستقبل الغرفة micModerationUpdated { roomId, userId, muted: false }.

لا يعيد فك الكتم حجز مقعد مايك تلقائيًا؛ على المستخدم طلب مقعد من جديد. يحفظ Laravel حالة الكتم ويحمّلها Node عند التحقق من الانضمام.

## الفشل

أخطاء الصلاحيات أو الحمولة تعاد في moderationResult مع success=false. فك كتم مستخدم غير مكتوم مسبقًا يعد نجاحًا أيضًا.

## المصدر

socket/moderation/moderation.events.js وmoderation.service.js وmoderation.state.js.

## الصوت عبر LiveKit

نفذوا تغيرات المايك ومغادرة المشاركين عبر LiveKit SDK كما يوضح [دليل LiveKit](../livekit.md). لا تغير أوامر Socket.IO صلاحيات LiveKit ولا تفصل مشاركيه مباشرة من الخادم.

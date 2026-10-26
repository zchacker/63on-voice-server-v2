# removeUser

**الاتجاه:** من مشرف الواجهة إلى الخادم. هذا طرد وليس حظرًا.

## الإدخال

    { "roomId": "room-123", "targetUserId": "user-42", "reason": "Disruption" }

reason اختياري ويقص إلى 1000 حرف في إشعار kicked.

## مخرجات النجاح

- يستقبل المنفذ moderationResult ناجحًا.
- تستقبل sockets الهدف النشطة kicked { roomId, userId, reason } وتغادر الغرفة.
- تستقبل الغرفة userRemoved { roomId, userId } وuserList وmicUpdate.
- تحذف رتبة temporary التي كانت للهدف.

يمكن للمستخدم الانضمام مجددًا فورًا لأن الحدث لا يسجل حظرًا.

## التحقق

يجب أن يكون المشرف مصرحًا ومنضمًا للغرفة المحددة. أخطاء الصلاحية تعود في moderationResult مع success=false.

## المصدر

socket/moderation/moderation.events.js وmoderation.service.js وmoderation.validation.js.

## الصوت عبر LiveKit

نفذوا تغيرات المايك ومغادرة المشاركين عبر LiveKit SDK كما يوضح [دليل LiveKit](../livekit.md). لا تغير أوامر Socket.IO صلاحيات LiveKit ولا تفصل مشاركيه مباشرة من الخادم.

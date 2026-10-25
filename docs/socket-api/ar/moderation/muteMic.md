# muteMic

**الاتجاه:** من مشرف الواجهة إلى الخادم.

## الإدخال

    { "roomId": "room-123", "targetUserId": "user-42" }

يمكن أن يكون الهدف غير متصل. يجب أن يكون المنفذ مشرفًا موثقًا داخل roomId.

## مخرجات النجاح

- يستقبل المنفذ moderationResult ناجحًا.
- تستقبل اتصالات الهدف النشطة micMuted { roomId, userId }.
- تستقبل الغرفة micModerationUpdated { roomId, userId, muted: true } وmicUpdate.
- عند دخول لاحق، يستقبل الهدف micMuted مرة أخرى.

يرفض الخادم requestMic وaudioData للمستخدم المكتوم. على الواجهة إيقاف الإرسال المحلي عند micMuted.

## الحفظ والثقة

الكتم في ذاكرة العملية ويضيع عند إعادة التشغيل. لا يمكن ضمان تطبيقه على عميل بلا JWT لأن العميل يستطيع ادعاء userId آخر.

## المصدر

socket/moderation/moderation.events.js وmoderation.service.js وmoderation.state.js وsocket/rooms/room.service.js.

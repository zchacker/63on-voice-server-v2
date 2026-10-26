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

يرفض الخادم requestMic للمستخدم المكتوم. على الواجهة إيقاف أو إلغاء نشر المايك عبر LiveKit عند micMuted. لا يفرض Node الكتم على خادم LiveKit حاليًا؛ وفحص audioData يخص ناقلًا قديمًا غير مستخدم. راجعوا [دليل LiveKit](../livekit.md).

## الحفظ والثقة

يحفظ Laravel الكتم ويعيده Node عند التحقق من الانضمام بعد إعادة التشغيل. لا يحدّث Node حالته المحلية أو يفرغ مقاعد الهدف أو يبث النجاح إلا بعد تأكيد Laravel.

## المصدر

socket/moderation/moderation.events.js وmoderation.service.js وmoderation.state.js وsocket/rooms/room.service.js.

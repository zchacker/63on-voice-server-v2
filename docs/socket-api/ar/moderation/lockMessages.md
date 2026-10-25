# lockMessages

**الاتجاه:** من مشرف الواجهة إلى الخادم.

## الإدخال

    { "roomId": "room-123" }

يجب أن يكون المنفذ في الغرفة ويحمل رتبة root أو fixed أو temporary.

## مخرج النجاح

- يستقبل المنفذ moderationResult مع action=lockMessages.
- تستقبل الغرفة messageLockUpdated { roomId, locked: true, changedBy, normalUsersOnly: true }.

يرفض sendMessage من المستخدم العادي عبر messageRejected مع MESSAGES_LOCKED. يمكن للمشرف الموثق الاستمرار في الإرسال.

## السلوك

إعادة قفل غرفة مقفلة مسبقًا تعتبر نجاحًا. حالة القفل في الذاكرة وتضيع عند إعادة التشغيل.

## المصدر

socket/moderation/moderation.events.js وmoderation.service.js وmoderation.validation.js وmoderation.state.js وsocket/chat/chat.validation.js.

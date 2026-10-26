# unlockMessages

**الاتجاه:** من مشرف الواجهة إلى الخادم.

## الإدخال

    { "roomId": "room-123" }

يجب أن يكون المنفذ موثقًا ومنضمًا للغرفة ومصرحًا له محليًا ومن Laravel. قد يسمح Laravel لمالك الغرفة أو fixed أو temporary المؤهل.

## مخرج النجاح

- يستقبل المنفذ moderationResult مع action=unlockMessages.
- تستقبل الغرفة messageLockUpdated { roomId, locked: false, changedBy, normalUsersOnly: false }.

بعد تأكيد Laravel يستطيع جميع الأعضاء إرسال الرسائل. يرسل Node الأمر unlock_messages أولًا ولا يحدّث نسخته المحلية أو يبث التغيير إلا بعد التأكيد. يحفظ Laravel حالة القفل.

## المصدر

socket/moderation/moderation.events.js وmoderation.service.js وmoderation.validation.js وmoderation.state.js.

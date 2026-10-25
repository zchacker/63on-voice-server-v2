# unlockMessages

**الاتجاه:** من مشرف الواجهة إلى الخادم.

## الإدخال

    { "roomId": "room-123" }

يجب أن يكون المنفذ في الغرفة ويحمل رتبة root أو fixed أو temporary.

## مخرج النجاح

- يستقبل المنفذ moderationResult مع action=unlockMessages.
- تستقبل الغرفة messageLockUpdated { roomId, locked: false, changedBy, normalUsersOnly: false }.

بعدها يستطيع جميع أعضاء الغرفة إرسال الرسائل. فك قفل غرفة مفتوحة يعتبر نجاحًا أيضًا. الحالة محفوظة في ذاكرة العملية وتضيع عند إعادة التشغيل.

## المصدر

socket/moderation/moderation.events.js وmoderation.service.js وmoderation.validation.js وmoderation.state.js.

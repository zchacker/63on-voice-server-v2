# lockMessages

**الاتجاه:** من مشرف الواجهة إلى الخادم.

## الإدخال

    { "roomId": "room-123" }

يجب أن يكون المنفذ موثقًا ومنضمًا للغرفة ومصرحًا له محليًا ومن Laravel. قد يسمح Laravel لمالك الغرفة أو fixed أو temporary المؤهل.

## مخرج النجاح

- يستقبل المنفذ moderationResult مع action=lockMessages.
- تستقبل الغرفة messageLockUpdated { roomId, locked: true, changedBy, normalUsersOnly: true }.

يرفض sendMessage من المستخدم العادي عبر messageRejected مع MESSAGES_LOCKED. يمكن للمشرف الموثق الاستمرار في الإرسال.

## السلوك

يرسل Node الأمر lock_messages إلى Laravel أولًا. يحفظ Laravel القفل؛ ولا يحدّث Node نسخته المحلية أو يبث messageLockUpdated إلا بعد تأكيد الحالة المقفلة. عند المهلة أو الرفض تكون success=false.

## المصدر

socket/moderation/moderation.events.js وmoderation.service.js وmoderation.validation.js وmoderation.state.js وsocket/chat/chat.validation.js.

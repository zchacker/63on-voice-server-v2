# unbanUser

**الاتجاه:** من مشرف الواجهة إلى الخادم.

## الإدخال

    { "roomId": "room-123", "targetUserId": "user-42" }

يجب أن يكون الحقلان نصين غير فارغين. يجب أن يكون المنفذ عضوًا في الغرفة ومشرفًا موثقًا.

## مخرجات النجاح

- يستقبل المنفذ moderationResult بنجاح.
- تستقبل الغرفة userUnbanned { roomId, userId }.

## الفشل

إذا لم يوجد حظر في الذاكرة، يعيد moderationResult مع success=false وcode=USER_NOT_BANNED. بقية أخطاء الصلاحيات والحقول في moderation/common.md.

إلغاء الحظر لا يعيد socket المطرود تلقائيًا؛ على المستخدم إرسال joinRoom مجددًا.

## المصدر

socket/moderation/moderation.events.js وmoderation.service.js وmoderation.validation.js وmoderation.state.js.

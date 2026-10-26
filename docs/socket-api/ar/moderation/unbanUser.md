# unbanUser

**الاتجاه:** من مشرف الواجهة إلى الخادم.

## الإدخال

    { "roomId": "room-123", "targetUserId": "user-42" }

يجب أن يكون الحقلان نصين غير فارغين. يجب أن يكون المنفذ عضوًا في الغرفة ومشرفًا موثقًا.

## مخرجات النجاح

- يستقبل المنفذ moderationResult بنجاح.
- تستقبل الغرفة userUnbanned { roomId, userId }.

## الفشل

يحدد Laravel هل يوجد حظر فعال. لا يمسح Node نسخته المحلية ولا يبث userUnbanned إلا بعد نجاح Laravel. تعاد أخطاء الخادم، ومنها USER_NOT_BANNED، داخل moderationResult.

إلغاء الحظر لا يعيد socket المطرود تلقائيًا؛ على المستخدم إرسال joinRoom مجددًا.

## المصدر

socket/moderation/moderation.events.js وmoderation.service.js وmoderation.validation.js وmoderation.state.js.

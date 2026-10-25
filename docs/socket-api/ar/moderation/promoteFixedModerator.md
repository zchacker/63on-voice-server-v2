# promoteFixedModerator

**الاتجاه:** من مشرف root إلى الخادم.

## الإدخال

    { "roomId": "room-123", "targetUserId": "user-44" }

يمكن أن يكون الهدف غير متصل. هذا الأمر متاح لـroot فقط.

## مخرجات النجاح

- يستقبل المنفذ moderationResult مع role=fixed.
- إن كان للهدف اتصالات نشطة بالغرفة، تستقبل roleUpdated { roomId, userId, role: "fixed" }.
- تستقبل الغرفة moderatorUpdated { roomId, userId, role: "fixed" }.

تبقى الرتبة بعد مغادرة الغرفة لكنها تنتهي عند توقف عملية Node؛ لا يوجد حفظ في قاعدة بيانات. تطبق عند دخول المستخدم التالي.

## الفشل

FORBIDDEN إذا لم يكن المنفذ root؛ INSUFFICIENT_ROLE إذا كان الهدف root؛ FIXED_MODERATOR إذا كان الهدف fixed بالفعل. راجع moderation/common.md.

## المصدر

socket/moderation/moderation.events.js وmoderation.service.js وmoderation.validation.js وmoderation.state.js.

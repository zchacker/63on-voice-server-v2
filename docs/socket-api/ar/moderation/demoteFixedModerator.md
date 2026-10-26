# demoteFixedModerator

**الاتجاه:** من مالك الغرفة المصادق إلى الخادم.

## الإدخال

    { "roomId": "room-123", "targetUserId": "user-44" }

يمكن أن يكون الهدف غير متصل. مالك الغرفة وحده يستطيع تغيير الرتبة الدائمة لمشرف fixed. يتحقق Laravel من الملكية والدور الحالي.

## مخرجات النجاح

- يستقبل المنفذ moderationResult مع role=normal ولقطة الحالة الحالية من Laravel.
- تستقبل اتصالات الهدف النشطة roleUpdated { roomId, userId, role: "normal" }.
- تستقبل الغرفة moderatorUpdated { roomId, userId, role: "normal" }.

يرسل Node الأمر demote_fixed إلى Laravel قبل تغيير النسخة المحلية أو بث النجاح.

## الفشل

FORBIDDEN إذا لم يكن المنفذ مالك الغرفة. قد يعيد Laravel PROTECTED_TARGET إذا كان الهدف المالك أو غير مؤهل للخفض. راجع moderation/common.md.

## المصدر

socket/moderation/moderation.events.js وmoderation.service.js وmoderation.validation.js وmoderation.state.js.

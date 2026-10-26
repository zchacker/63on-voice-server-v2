# promoteFixedModerator

**الاتجاه:** من مالك الغرفة المصادق إلى الخادم.

## الإدخال

    { "roomId": "room-123", "targetUserId": "user-44" }

يمكن أن يكون الهدف غير متصل. يتحقق Laravel من أن المنفذ مالك الغرفة وأن الهدف مؤهل للترقية.

## مخرجات النجاح

- يستقبل المنفذ moderationResult مع role=fixed ولقطة الحالة الحالية من Laravel.
- إن كان للهدف اتصالات نشطة بالغرفة، تستقبل roleUpdated { roomId, userId, role: "fixed" }.
- تستقبل الغرفة moderatorUpdated { roomId, userId, role: "fixed" }.

يرسل Node الأمر promote_fixed إلى Laravel قبل تغيير النسخة المحلية أو بث النجاح. تبقى الرتبة بعد مغادرة الهدف وتستمر بعد إعادة تشغيل Node لأن Laravel يحفظها.

## الفشل

FORBIDDEN إذا لم يكن المنفذ مالك الغرفة؛ PROTECTED_TARGET إذا كان الهدف مالكًا أو root؛ LARAVEL_TIMEOUT أو LARAVEL_UNAVAILABLE عند تعذر إكمال الأمر في Laravel. راجع moderation/common.md.

## المصدر

socket/moderation/moderation.events.js وmoderation.service.js وmoderation.validation.js وmoderation.state.js.

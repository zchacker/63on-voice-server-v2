# promoteTemporaryModerator

**الاتجاه:** من مشرف الواجهة إلى الخادم.

## الإدخال

    { "roomId": "room-123", "targetUserId": "user-43" }

يجب أن يكون الهدف حاضرًا في الغرفة، وأن تحمل كل اتصالاته النشطة JWT موثقًا يطابق sub مع targetUserId.

## مخرجات النجاح

- يستقبل المنفذ moderationResult مع role=temporary.
- تستقبل اتصالات الهدف roleUpdated { roomId, userId, role: "temporary" }.
- تستقبل الغرفة moderatorUpdated بالحقول نفسها.

تنتهي الرتبة عندما يغادر آخر socket للهدف الغرفة أو ينقطع.

## رموز الفشل

- TARGET_NOT_IN_ROOM
- TARGET_NOT_AUTHENTICATED
- FIXED_MODERATOR
- بالإضافة إلى أخطاء الحقول والرتب في moderation/common.md.

لا يستطيع temporary ترقية مشرف آخر. يستطيع مالك الغرفة أو fixed أو root المحلي منح هذه الرتبة الحية. لا يحفظها Laravel.

## المصدر

socket/moderation/moderation.events.js وmoderation.service.js وmoderation.validation.js وmoderation.state.js.

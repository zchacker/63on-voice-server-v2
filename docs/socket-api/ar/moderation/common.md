# الإشراف: القواعد المشتركة

لكل أمر حدث مستقل. لا تستخدم الأحداث acknowledgement أو callback. كل طلب يعيد moderationResult إلى المشرف المرسل.

## شكل الطلب المشترك

الأمر المستهدف:

    { "roomId": "room-123", "targetUserId": "user-42" }

يمكن أن يضيف banUser وremoveUser حقل reason نصيًا. أما lockMessages وunlockMessages فيستخدمان roomId فقط.

## moderationResult

    {
      "action": "banUser",
      "success": true,
      "code": "OK",
      "message": "Action completed.",
      "roomId": "room-123",
      "targetUserId": "user-42",
      "role": "temporary"
    }

targetUserId وrole اختياريان. الطلب الفاشل يعيد success=false مع code وmessage.

## رتب المنفذ

- root: معرف JWT الموثق موجود في SOCKET_ROOT_MODERATOR_IDS.
- fixed: دور ثابت محفوظ في عملية Node الحالية.
- temporary: دور لهذه الغرفة إلى أن يغادر آخر socket للمستخدم.
- normal: لا يملك صلاحية إشراف.

يجب أن يكون المنفذ داخل الغرفة المحددة وأن يكون لديه JWT صالح يطابق sub مع userId المسجل. لا تمنح حقول role القادمة من العميل صلاحيات. يستطيع root ترقية مشرف ثابت. يستطيع fixed أو root منح رتبة مؤقتة. يستطيع temporary الحظر والطرد والكتم وفتح المايك وقفل وفتح الرسائل، ولا يستطيع الترقية.

لا يستطيع المشرف استهداف نفسه أو root. لا يستطيع غير root إدارة fixed. ولا يمكن ترقية fixed مرة أخرى.

## أكواد الأخطاء

قد تعيد الأوامر المستهدفة: INVALID_ROOM_ID أو NOT_IN_ROOM أو INVALID_TARGET_USER_ID أو FORBIDDEN أو SELF_TARGET أو INSUFFICIENT_ROLE أو FIXED_MODERATOR أو TARGET_NOT_IN_ROOM أو TARGET_NOT_AUTHENTICATED أو USER_NOT_BANNED. أوامر القفل قد تعيد NOT_IN_ROOM أو FORBIDDEN. يحمل moderationResult كل هذه الأخطاء.

## عمر الحالة

حالة الإشراف كلها في ذاكرة العملية وتضيع عند إعادة تشغيل Node. لا يوجد اتصال بـLaravel أو حفظ في قاعدة بيانات.

## المصدر

socket/moderation/moderation.events.js وmoderation.service.js وmoderation.validation.js وmoderation.state.js.

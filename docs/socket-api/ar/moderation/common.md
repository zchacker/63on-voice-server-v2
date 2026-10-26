# الإشراف: القواعد المشتركة

لكل أمر حدث Socket.IO مستقل، ويعيد moderationResult إلى المنفذ. لا توجد acknowledgement callbacks.

## أشكال الطلبات

الأمر المستهدف:

    { "roomId": "room-123", "targetUserId": "user-42" }

يمكن أن يضيف banUser وremoveUser حقل reason. يستخدم lockMessages وunlockMessages حقل roomId فقط. يستخدم demoteFixedModerator شكل الطلب المستهدف نفسه الذي يستخدمه promoteFixedModerator.

## moderationResult

    {
      "action": "banUser",
      "success": true,
      "code": "OK",
      "message": "Action completed.",
      "roomId": "room-123",
      "targetUserId": "user-42",
      "state": {
        "banned": true,
        "role": "normal",
        "micMuted": false,
        "messagesLocked": false
      }
    }

قد لا يظهر targetUserId أو role إذا لم ينطبق. تتضمن الأوامر المحفوظة لقطة الحالة التي أعادها Laravel. عند الفشل تكون success=false مع code وmessage.

## الأدوار والصلاحيات

- owner: مالك الغرفة كما يحدده Laravel.
- fixed: مشرف دائم تحمّله Node من Laravel.
- temporary: رتبة للغرفة محفوظة في ذاكرة Node وتنتهي عند مغادرة آخر اتصال للمستخدم.
- root: معرف محلي ضمن SOCKET_ROOT_MODERATOR_IDS. لا يتجاوز قرار Laravel للأوامر المحفوظة.
- normal: مستخدم عادي.

يلزم JWT موثق للانضمام والإشراف، ويجب أن يطابق sub معرف المستخدم المنضم. لا تمنح حقول الدور المرسلة من العميل أي صلاحية. يعيد Laravel التحقق من الأوامر المحفوظة.

مالك الغرفة فقط يستطيع ترقية أو خفض مشرف fixed. يستطيع owner وfixed وtemporary تنفيذ أوامر الإدارة التشغيلية التي يسمح بها Laravel. يجب خفض رتبة fixed قبل استهدافه بأمر إشراف آخر. لا يمكن للمستخدم استهداف نفسه أو مالك الغرفة.

## الحفظ وسلوك الفشل

ترسل الأوامر banUser وunbanUser وpromoteFixedModerator وdemoteFixedModerator وmuteMic وunmuteMic وlockMessages وunlockMessages إلى Laravel قبل تغيير ذاكرة Node أو بث النجاح. Laravel هو مصدر الحقيقة الدائم. عند الفشل أو انتهاء المهلة يعيد Node moderationResult مع success=false ولا يبث نجاحًا.

يعمل promoteTemporaryModerator وremoveUser على الاتصال الحي فقط. يحذف دور temporary عند مغادرة آخر اتصال نشط للمستخدم. يستدعي Node Laravel عند كل انضمام لاستعادة الدور الثابت وحالة الحظر وكتم المايك وقفل الرسائل.

تحتوي حالة الأمر المحفوظ الناجح على القيم الحالية banned وrole وmicMuted وmessagesLocked. استخدموا هذه اللقطة لتحديث عناصر التحكم في الواجهة.

لكل عملية Node نسخة حالة في الذاكرة. لا يوجد حاليًا Socket.IO adapter لتزامن الأحداث بين العمال؛ لذلك يصل البث الفوري إلى اتصالات العامل الذي استقبل الأمر.

## أكواد الأخطاء الشائعة

INVALID_ROOM_ID وAUTHENTICATION_REQUIRED وNOT_IN_ROOM وINVALID_TARGET_USER_ID وFORBIDDEN وSELF_TARGET وPROTECTED_TARGET وTARGET_NOT_IN_ROOM وTARGET_NOT_AUTHENTICATED وUSER_NOT_BANNED وLARAVEL_TIMEOUT وLARAVEL_UNAVAILABLE وLARAVEL_SERVICE_AUTH_FAILED وLARAVEL_STATE_MISMATCH.

## المصدر

socket/moderation/moderation.events.js وmoderation.service.js وmoderation.validation.js وmoderation.state.js وservices/laravel.service.js.


## استعادة النتيجة عند فقد رد Laravel

يعيد Node محاولة الطلب المتعثر حتى ثلاث مرات بنفس requestId والحمولة، ويحافظ على فحصي تطابق requestId. إذا بقيت النتيجة مجهولة، يصل kicked للأعضاء النشطين وتُنهى عضويتهم دون بث نجاح. يحتفظ Node بالأمر المعلق؛ ويتطلب الانضمام الجديد استرجاع نتيجته بنفس UUID ثم طلب authorize-join حديث. يحذف الرفض القطعي من Laravel الأمر المعلق.

تقبل أوامر الإشراف roomId الموحد كنص أو عدد آمن، أو المعرّف الذي استخدمه المنفذ عند دخوله. تستخدم الردود roomId الموحد. تستخدم state.role تسميات Laravel: owner/fixed_moderator/normal؛ وتستخدم roleUpdated القيم owner/fixed/temporary/root/normal.

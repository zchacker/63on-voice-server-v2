# مرجع Socket.IO API

يوثق هذا المجلد عقد Socket.IO الفعلي اعتمادًا على ملفات الأحداث وخدماتها داخل socket/. لا يشمل مجلد demo. لكل حدث يرسله العميل صفحة مستقلة.

## الاتصال والقواعد العامة

- راجع connection.md لعنوان الاتصال وبيانات handshake والمصادقة والهوية.
- الخادم يستخدم Socket.IO وليس WebSocket خامًا. المنفذ PORT أو 3000 افتراضيًا.
- لا يستخدم الخادم acknowledgements أو callbacks؛ راجع صفحة الحدث لمعرفة أحداث الرد والأخطاء.
- يجب الانضمام لغرفة قبل أحداث الغرفة.
- راجع server-events.md لقائمة كاملة بأحداث الإخراج وحمولاتها.
- كل صفحة تذكر ملفات المصدر.

## أحداث الغرف والمستخدم

- rooms/joinRoom.md
- users/leaveRoom.md
- users/disconnect.md
- rooms/requestMic.md
- rooms/leaveMic.md
- rooms/audioData.md

## الرسائل والهدايا

- chat/sendMessage.md
- gifts/sendGift.md

## الإشراف

- moderation/common.md
- moderation/banUser.md
- moderation/unbanUser.md
- moderation/removeUser.md
- moderation/promoteTemporaryModerator.md
- moderation/promoteFixedModerator.md
- moderation/muteMic.md
- moderation/unmuteMic.md
- moderation/lockMessages.md
- moderation/unlockMessages.md

## قيود التنفيذ الحالية

- لا يوجد تحقق من عضوية الغرفة أو ملكيتها عبر Laravel أو قاعدة بيانات.
- الحالات في ذاكرة عملية Node.js فقط؛ تضيع الحظورات والأدوار الثابتة وكتم المايك وقفل الرسائل عند إعادة التشغيل.
- JWT اختياري للانضمام. جلسة بلا JWT يمكنها دخول الغرفة بمعرف userId يرسله العميل؛ هذه الهوية غير موثوقة لأغراض الإشراف.
- الهدايا بث بيانات فقط، بلا تحقق من الدفع أو الرصيد.

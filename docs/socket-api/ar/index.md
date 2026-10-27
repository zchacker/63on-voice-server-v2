# مرجع Socket.IO API

يوثق هذا المجلد عقد Socket.IO الفعلي اعتمادًا على ملفات الأحداث وخدماتها داخل socket/. لا يشمل مجلد demo. لكل حدث يرسله العميل صفحة مستقلة.

- الصوت: [دليل LiveKit](livekit.md) — livekit.63on.com، وتوكنه من Laravel POST /api/room/join. الحدث audioData قديم ولا يستخدمه التطبيق.

## الاتصال والقواعد العامة

- ابدأ من [دليل ربط الواجهة](frontend-integration.md) لمعرفة تدفق الاتصال والغرفة كاملًا.
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
- rooms/roomUpdated.md

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
- moderation/demoteFixedModerator.md
- moderation/muteMic.md
- moderation/unmuteMic.md
- moderation/lockMessages.md
- moderation/unlockMessages.md

## قيود التنفيذ الحالية

- يتحقق Laravel من كل انضمام للغرفة ويحفظ الحظر والأدوار الثابتة وكتم المايك وقفل الرسائل.
- يلزم JWT للانضمام؛ قد يفتح الاتصال بدونه لكن joinRoom يرفضه.
- يخزن Laravel قيمة `online_count` لقائمة الغرف، ويرسل Node إشعاري الانضمام والمغادرة داخليًا إلى Laravel. لا يوجد حدث Socket.IO لعدّاد الغرف. بقية الحالة الحية مثل مقاعد المايك والأدوار المؤقتة تبقى محلية لكل عملية.
- الهدايا بث بيانات فقط، بلا تحقق من الدفع أو الرصيد.

## أحداث قديمة باقية في المصدر

- [audioData](rooms/audioData.md): غير مستخدم في تدفق الصوت عبر LiveKit.

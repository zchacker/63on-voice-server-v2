# مرجع Socket.IO للواجهة الأمامية

ابدأ من [دليل ربط الواجهة](docs/socket-api/ar/frontend-integration.md)، ثم استخدم [فهرس API العربي](docs/socket-api/ar/index.md) لفتح مواصفة كل حدث في ملف مستقل.

توضح كل صفحة الحمولة التي يرسلها العميل، وأحداث رد الخادم، وأكواد الأخطاء، والسلوك الفعلي، وملفات المصدر. تفاصيل الاتصال وJWT في [صفحة الاتصال](docs/socket-api/ar/connection.md)، وقائمة كل أحداث الخادم في [أحداث الخادم](docs/socket-api/ar/server-events.md).

المرجع الإنجليزي الأساسي موجود في docs/socket-api/en/ ويبدأ من [API index](docs/socket-api/en/index.md).

تصف هذه المراجع الكود الفعلي تحت socket/ ولا تشمل demo/. يتحقق Laravel من دخول الغرفة ويحفظ أوامر الإشراف الدائمة؛ وتبقى الأدوار المؤقتة وحالة الاتصالات الحية في ذاكرة Node.

أضيف حدث roomUpdated لإبلاغ أعضاء الغرفة بتغير الحقول العامة بعد حفظها. قائمة الأحداث وحمولاتها في [أحداث الخادم](docs/socket-api/ar/server-events.md)، وعقد Laravel الداخلي في [roomUpdated](docs/socket-api/ar/rooms/roomUpdated.md).

يعمل الصوت عبر LiveKit على livekit.63on.com، ويعيد Laravel توكنه من POST /api/room/join. راجعوا [دليل LiveKit](docs/socket-api/ar/livekit.md). الحدث audioData قديم وغير مستخدم في التطبيق الحالي.

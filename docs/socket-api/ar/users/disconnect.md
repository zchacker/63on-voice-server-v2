# disconnect (حدث دورة حياة يطلقه الخادم)

**الاتجاه:** من Socket.IO إلى التطبيق؛ لا يرسله العميل.

يطلق Socket.IO حدث disconnect عند انقطاع الاتصال. يستدعي handler نفس تنظيف leaveRoom:
- إزالة socket من حالة الغرفة.
- إخلاء مقاعد المايك الخاصة بالمستخدم.
- بث userList وmicUpdate عند الحاجة.
- حذف رتبة المشرف المؤقتة بعد مغادرة آخر اتصال للمستخدم.

لا توجد حمولة أو إقرار. هذا إشعار دورة حياة وليس طلب API من العميل.

## المصدر

socket/users/user.events.js وuser.service.js وsocket/rooms/room.service.js.

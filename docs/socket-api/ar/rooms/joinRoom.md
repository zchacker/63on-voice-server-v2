# joinRoom

**الاتجاه:** من العميل إلى الخادم.

## الإدخال

    { "roomId": "room-123" }

يقبل roomId معرف قاعدة البيانات كعدد صحيح موجب وآمن أو نص غير فارغ. يدعم Laravel اسم الغرفة أيضًا. يوحّد Node العضوية وحالة الإشراف باستخدام معرف قاعدة البيانات المعاد من Laravel.

يمكن إرسال كائن user القديم اختياريًا للتوافق، لكن الخادم يتجاهله. لا يعتمد الخادم على الملف الشخصي أو الهوية أو الدور المرسل من العميل. يلزم JWT صالح للسوكيت للانضمام.

## تدفق التحقق

1. يأخذ Node معرف المستخدم من claim sub في JWT الموثق.
2. يستدعي Node Laravel عبر POST /api/internal/socket/v1/rooms/{roomId}/authorize-join ويرسل userId وconnectionId الحالي.
3. يتحقق Laravel من الغرفة وحق المستخدم في الانضمام والحظر والدور الثابت وكتم المايك وقفل الرسائل.
4. يحتوي كائن الغرفة الموثوق على `liveKitRoomName` المساوي لـ`rooms.username` في Laravel؛ يحتفظ به Socket داخليًا لاستخدامه عند إدارة المشاركين في LiveKit.
5. يدخل Node المستخدم إلى غرفة Socket.IO فقط إذا أعاد Laravel allowed=true ومعرف مستخدم مطابقًا للتوكن.

## المخرجات عند النجاح

- تستقبل الغرفة userList وفيه ملف المستخدم الموثوق من Laravel مع socketId.
- تستقبل الغرفة micUpdate بحالة المقاعد الحالية أو {}.
- يستقبل الاتصال roleUpdated { roomId, userId, role } حيث يمكن أن تكون role: owner أو fixed أو temporary أو root أو normal.
- يستقبل الاتصال messageLockUpdated { roomId, locked, normalUsersOnly }.
- يستقبل المستخدم المكتوم أيضًا micMuted { roomId, userId }.

لا يوجد acknowledgement callback. اعتبر ظهور المستخدم الحالي في userList إشارة النجاح العملية.

## الرفض

يتضمن joinRoomRejected الحقول roomId وuserId وcode وmessage. تشمل الأكواد:
- INVALID_ROOM_ID: roomId ليس نصًا غير فارغ ولا عددًا صحيحًا موجبًا وآمنًا.
- AUTHENTICATION_REQUIRED: لم يحتو handshake على JWT صالح للسوكيت.
- USER_BANNED أو ROOM_NOT_FOUND أو ROOM_INACTIVE أو USER_NOT_FOUND أو JOIN_NOT_ALLOWED: رفض Laravel الانضمام.
- LARAVEL_TIMEOUT أو LARAVEL_UNAVAILABLE أو SOCKET_CONFIGURATION_MISSING: تعذر على Node إكمال طلب التحقق الداخلي من Laravel.
- INVALID_LARAVEL_RESPONSE أو INVALID_LARAVEL_IDENTITY: أعاد Laravel قرارًا غير صالح أو معرف مستخدم لا يطابق sub.

إذا رُفض الانضمام إلى غرفة جديدة، يبقى الاتصال في غرفته السابقة. عند نجاح إعادة الانضمام، يغادر الغرفة السابقة بعد موافقة Laravel على الجديدة.

## ملاحظات

Laravel هو مصدر بيانات الملف الشخصي وحالة الغرفة الدائمة. تصل المعرّفات المقبولة المختلفة للغرفة نفسها إلى غرفة Socket.IO واحدة. تكون roomId في أحداث الخادم هي معرف قاعدة البيانات كنص؛ استخدمها في أوامر الإشراف التالية. لا يستخدم الانضمام حظر الذاكرة المحلية لاتخاذ قرار السماح.

## المصدر

socket/rooms/room.events.js وsocket/rooms/room.service.js وsocket/rooms/room.validation.js وservices/laravel.service.js.

يرفض الانضمام ما دامت نتيجة أمر إشراف معلق غير مؤكدة. يعني ROOM_STATE_UNCERTAIN أن Laravel لم يعد نتيجة موثوقة للأمر؛ أعد المحاولة بعد تعافي الخدمة. يتطلب ROOM_CHANGED طلب انضمام جديدًا لأن المعرّف أصبح يشير إلى غرفة أخرى أثناء التحقق.

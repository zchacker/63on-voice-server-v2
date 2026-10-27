# ربط الصوت عبر LiveKit

## مسؤولية كل خدمة

يعمل نشر الصوت والاستماع والاشتراك في المسارات الصوتية عبر خادم LiveKit الموجود على livekit.63on.com. عنوان اتصال SDK الآمن هو wss://livekit.63on.com. استخدموا LiveKit SDK الخاص بمنصة الواجهة.

يدير Socket.IO الحضور وقوائم المستخدمين ومقاعد المايك والرسائل والهدايا والأدوار وإشعارات الإشراف. ينسق requestMic وleaveMic المقاعد؛ أما audioData وaudioDataRejected فهما حدثان قديمان ما زالا موجودين في المصدر ولا يستخدمهما تدفق الصوت الحالي للتطبيق.

## توكنان مستقلان

| الغرض | مسار Laravel | التوكن المعاد | أين تستخدمه الواجهة |
| --- | --- | --- | --- |
| توثيق هوية اتصال Socket.IO | POST /api/socket/session | socket_token | داخل auth.token في handshake |
| دخول غرفة الصوت في LiveKit | POST /api/room/join | data.token | اتصال LiveKit SDK إلى wss://livekit.63on.com |

يستخدم الطلبان Authorization: Bearer <sanctum-token>. لا تبدلوا التوكنين ولا ترسلوا أسرار التوقيع أو اعتماد الخدمة إلى الواجهة.

رد Socket session هو JSON مباشر. أما مسار LiveKit فيستخدم envelope الخاص بـLaravel: تحققوا من نجاح HTTP ومن body.success قبل قراءة data.token.

## معرّفات الغرفة

يحتوي نموذج الغرفة على id في قاعدة البيانات وusername. أرسلوا id إلى Socket.IO في roomId. يستخدم متحكم LiveKit الحالي في Laravel قيمة room_id كما وصلت اسمًا لغرفة LiveKit، ويقارنها مع rooms.username لتحديد المالك. لذلك استخدموا username في room_id ضمن هذا الربط الحالي مع LiveKit.

مثال غرفة id الخاص بها 10 وusername يساوي "1234567890123456":

    socket.emit("joinRoom", { roomId: "10" });

طلب توكن LiveKit:

    POST /api/room/join
    Authorization: Bearer <sanctum-token>
    Accept: application/json
    Content-Type: application/json

    { "room_id": "1234567890123456" }

رد النجاح:

    {
      "success": true,
      "status": 200,
      "error": null,
      "data": {
        "user": { "userId": 42, "name": "Sara", "img": "..." },
        "permission": "user",
        "token": "<livekit-jwt>"
      }
    }

مدة توكن LiveKit الحالية ساعة. تكون permission مساوية admin للمالك المطابق لاسم الغرفة، وإلا تكون user. احصلوا على كائن الغرفة الفعلي من Laravel واحتفظوا بربط id مع username حتى يشير اتصالا Socket.IO وLiveKit إلى غرفة التطبيق نفسها.

## خطوات الربط في الواجهة

1. سجّلوا الدخول عبر Laravel/Sanctum.
2. اطلبوا /api/socket/session، ثم اتصلوا بـSocket.IO باستخدام socket_token وأرسلوا joinRoom مع room.id.
3. انتظروا نجاح الانضمام إلى Socket.IO، ثم اطلبوا /api/room/join باستخدام room.username واتصلوا بـLiveKit SDK باستخدام data.token.
4. استمعوا للصوت عبر اشتراكات LiveKit. عند takeMic فعّلوا أو انشروا المايك المحلي عبر LiveKit SDK.
5. عند leaveMic أو micMuted أوقفوا أو ألغوا نشر المايك عبر LiveKit. يعيد micUnmuted أهلية طلب الكلام؛ اطلبوا مقعدًا قبل النشر.
6. عند kicked غادروا واجهة غرفة Socket وغرفة LiveKit معًا. وعند الخروج المقصود غادروا الخدمتين. عالجوا الانقطاع وإعادة الاتصال لكل خدمة بصورة مستقلة.

لا ترسلوا إطارات الصوت عبر Socket.IO. حالة اتصال Socket.IO منفصلة عن LiveKit؛ نجاح الاتصال بإحداهما لا ينشئ اتصالًا بالأخرى.

## حدود التنفيذ الحالي

يستدعي Node واجهة LiveKit Server لإزالة المشاركين النشطين عند `banUser` و`removeUser`. لكنه لا يكتم المسارات ولا يغير صلاحية النشر عند كتم المايك؛ لذلك يجب على الواجهة إيقاف نشر المايك محليًا عند `micMuted`.

يتحقق متحكم Laravel الحالي في `/api/room/join` من الحظر الفعّال ويرفض الطلب بالرمز `USER_BANNED` قبل إصدار التوكن. لكنه لا يتحقق من أهلية مقعد المايك ولا يفرض كتم Socket على LiveKit. وتحتاج إزالة المشارك من LiveKit إلى أن يتضمن رد `/authorize-join` اسم غرفة موثوقًا في `room.liveKitRoomName` (`rooms.username`)؛ الاستجابة الموثقة حاليًا لا تتضمن هذا الحقل.

## المصادر

عنوان الصوت المحدد من مالك المشروع: livekit.63on.com. مرجع Laravel API_REFERENCE.md وapp/Http/Controllers/Api/Room/RoomsContoller.php في join_room. ملفات Node: socket/rooms/room.events.js وroom.service.js.

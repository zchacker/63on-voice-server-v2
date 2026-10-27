# دليل ربط الواجهة الأمامية

يعطي هذا الدليل خطوات عملية للاتصال بخادم Socket.IO الحالي. تكمله مواصفات الأحداث المنفصلة في هذا المجلد؛ وتبقى صفحات كل حدث مرجع الحقول والتفاصيل الدقيقة.

يعمل الصوت عبر [LiveKit](livekit.md) على livekit.63on.com، ويتولى Socket.IO أحداث التطبيق. اطلبوا توكن LiveKit من Laravel /api/room/join بصورة مستقلة عن JWT السوكيت.

## 1. اجمع إعدادات الاتصال

تحتاج الواجهة إلى عنوان خادم Socket وroomId وJWT قصير العمر خاص بالسوكيت. اطلب التوكن من Laravel عبر POST /api/socket/session بعد تسجيل الدخول المعتاد. لا تحتاج الواجهة إلى إرسال معرف المستخدم أو دوره لإثبات الهوية.

يستخدم الخادم المنفذ 3000 ما لم يضبط PORT. إعداد CORS الحالي يسمح بجميع النطاقات؛ واستخدموا HTTPS وعنوان الإنتاج الصحيح.

يجب استخدام مكتبة Socket.IO المسماة socket.io-client، وليس WebSocket خامًا.

## 2. احصل على توكن يقبله خادم Socket

بعد تسجيل الدخول، استدعِ Laravel عبر POST /api/socket/session باستخدام مصادقة Sanctum للمستخدم، ثم استخدم socket_token المعاد. توكن Sanctum ليس JWT. يقبل Socket JWT من نوع HS256 ويحمل typ=JWT وclaims مطابقة sub وexp وiss وaud؛ ويفحص nbf عند وجوده. القيم الافتراضية للمُصدر والجمهور 63on-backend و63on-socket. يجب أن تكون قيمة SOCKET_JWT_SECRET نفسها في Laravel وNode. لا تضع أي سر للخادم في الواجهة.

قد يفتح اتصال النقل دون توكن، لكن joinRoom يتطلب JWT صالحًا. لا يثق الخادم في userId المرسل من العميل.

يطلب تطبيق الهاتف التوكن قبل الاتصال:

    const response = await fetch(laravelOrigin + "/api/socket/session", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + sanctumToken,
        "Accept": "application/json"
      }
    });
    if (!response.ok) throw new Error("Socket session could not be issued.");
    const session = await response.json();
    const socketJwt = session.socket_token;
    const userId = String(session.user.id);

يثبت JWT هوية المستخدم. يستدعي Node أيضًا authorize-join الداخلي للتحقق من الغرفة والحظر قبل قبول الانضمام. يرسل الهاتف { roomId } فقط، وتحتوي أحداث الخادم على معرف قاعدة البيانات الموحد كنص.

## 3. أنشئ الاتصال وسجل المستمعين قبل الاتصال

    import { io } from "socket.io-client";

    const socket = io("https://<SOCKET_HOST>", {
      autoConnect: false,
      reconnection: true,
      auth: { token: socketJwt }
    });

    socket.on("connect", () => {
      // يعمل عند الاتصال الأول وبعد كل إعادة اتصال ناجحة.
      socket.emit("joinRoom", { roomId });
    });

    socket.on("connect_error", (error) => {
      // عند JWT غير صالح تبدأ الرسالة بـ AUTHENTICATION_FAILED.
      showConnectionError(error.message);
    });

    socket.on("joinRoomRejected", ({ code, message }) => {
      showJoinError(code, message);
    });

    socket.on("userList", (users) => {
      updateRoomUsers(users);
      // اعتبر الغرفة متصلة عندما تتضمن القائمة userId الحالي.
    });

    socket.on("micUpdate", (spots) => updateMicSpots(spots));
    socket.on("roleUpdated", ({ role }) => updateMyRole(role));
    socket.on("messageLockUpdated", (state) => updateMessageLock(state));
    socket.on("micMuted", () => stopLiveKitMicrophonePublishing());
    socket.on("micUnmuted", () => showMicrophoneAvailable());

    socket.connect();

سجلوا كل المستمعين قبل استدعاء connect حتى لا تفوتكم حالة الغرفة الأولية. الخادم لا يرسل إقرار انضمام ولا حدثًا باسم roomJoined. عند النجاح يبث userList وmicUpdate للغرفة ويرسل roleUpdated وmessageLockUpdated للمنضم. استخدموا ظهور المستخدم الحالي في userList كتأكيد عملي للانضمام، ولا تفعّلوا عمليات الغرفة قبله.

## 4. أعد الانضمام بعد انقطاع الاتصال

ينشئ Socket.IO اتصالًا جديدًا بالخادم بعد الانقطاع. لا يعيد الخادم العضوية للغرفة تلقائيًا. معالج connect أعلاه يرسل joinRoom بعد كل اتصال ويعيد تحميل userList وmicUpdate والدور وحالة القفل.

الانقطاع يشغّل تنظيف الخادم أيضًا. يمسح مقاعد المايك لهذا المستخدم، وقد يحذف دور temporary بعد انقطاع آخر اتصال له. بعد إعادة الاتصال، اعتمدوا قيمة roleUpdated الجديدة ولا تفترضوا استمرار الدور المؤقت.

لتحديث التوكن، حدثوا socket.auth قبل إعادة الاتصال:

    socket.auth = { token: refreshedSocketJwt };
    socket.connect();

يفصل الخادم الاتصال عند انتهاء التوكن ويرفض الأحداث بعد exp. حدّثوا التوكن قبل انتهاء صلاحيته ثم أعيدوا الاتصال بالتوكن الجديد.

## 5. دورة حياة الغرفة

أرسلوا joinRoom بعد تسجيل الدخول وجاهزية التوكن:

    socket.emit("joinRoom", { roomId });

يستخدم Node معرف sub ثم يطلب موافقة Laravel قبل الانضمام. Laravel يرسل الملف الشخصي وحالة الإشراف المحفوظة. إذا رفض Laravel غرفة جديدة يبقى الاتصال في غرفته السابقة.

أرسلوا مغادرة صريحة قبل الخروج المقصود من الغرفة:

    socket.emit("leaveRoom");

لا يوجد إقرار لمغادرة الغرفة. يبث الخادم userList، ويبث micUpdate إذا تغير مقعد مايك. الانقطاع اللاحق ينظف الحالة أيضًا.

يتحقق Laravel الآن من حق الانضمام عبر authorize-join قبل إدخال المستخدم إلى غرفة Socket.IO. يرفض Node الانضمام عند رفض Laravel أو تعذر التحقق.

## 6. أرسل الرسائل والهدايا

لا يفرض الخادم مخططًا للرسالة أو الهدية. اتفقوا على شكل الكائن مع فريق المنتج/Laravel. الأمثلة التالية اصطلاح واجهة فقط وليست مخططات يفرضها الخادم:

    socket.emit("sendMessage", {
      id: "msg-123",
      text: "Hello",
      createdAt: new Date().toISOString()
    });

    socket.emit("sendGift", {
      id: "gift-rose",
      name: "Rose"
    });

استمعوا إلى بث الغرفة:

    socket.on("newMessage", ({ message, user }) => appendMessage(user, message));
    socket.on("sendGift", ({ gift, user }) => showGift(user, gift));

تصل الرسالة للمرسل ولأعضاء الغرفة. الهدية تبث فقط؛ لا يتحقق الخادم من السعر أو الرصيد أو الدفع أو المخزون.

عند قفل الدردشة يستقبل المستخدم العادي messageRejected مع MESSAGES_LOCKED. يظل المشرف قادرًا على الإرسال.

## 7. الصوت ومقاعد المايك: LiveKit

ينقل التطبيق الصوت بالكامل عبر LiveKit على wss://livekit.63on.com. اطلبوا توكنه من Laravel عبر POST /api/room/join واستخدموا data.token مع LiveKit SDK. يختلف هذا التوكن عن JWT السوكيت الصادر من /api/socket/session.

راجعوا [دليل LiveKit](livekit.md) لشكل الطلب والرد والفرق بين room.id وroom.username وترتيب الاتصال وحدود الإشراف الحالية.

تنسق أحداث Socket.IO مقاعد المايك من 0 إلى 7 وتحدث الواجهة:

    socket.emit("requestMic", { spotNumber: 2 });
    socket.on("takeMic", ({ spotNumber }) => {
      // فعّلوا أو انشروا المايك عبر LiveKit SDK الخاص بالمنصة.
    });
    socket.on("micMuted", () => {
      // أوقفوا أو ألغوا نشر المايك عبر LiveKit.
    });
    socket.emit("leaveMic", { spotNumber: 2 });
    socket.on("leaveMic", () => {
      // أوقفوا أو ألغوا نشر المايك عبر LiveKit.
    });

عالجوا micRejected للمقعد المشغول وmicRequestRejected للطلب غير الصالح أو المكتوم وmicLeaveRejected لرفض تحرير المقعد. لا تحمل هذه الأحداث الصوت. غادروا غرفة LiveKit أيضًا عند kicked أو الخروج المقصود.

audioData وaudioDataRejected حدثان قديمان في المصدر. لا تنفذوا بث الصوت أو الاستماع من خلالهما في الواجهة الحالية.

## 8. تدفق الإشراف

سجلوا مستمعي نتيجة الإشراف وتغيرات الغرفة قبل تفعيل أدوات الإدارة:

    socket.on("moderationResult", (result) => {
      if (!result.success) showError(result.code, result.message);
    });
    socket.on("moderatorUpdated", ({ userId, role }) => updateMemberRole(userId, role));
    socket.on("micModerationUpdated", ({ userId, muted }) => updateMemberMute(userId, muted));
    socket.on("userBanned", ({ userId }) => removeMember(userId));
    socket.on("userUnbanned", ({ userId }) => refreshBanState(userId));
    socket.on("userRemoved", ({ userId }) => removeMember(userId));
    socket.on("kicked", ({ reason }) => leaveRoomView(reason));

استخدموا userId الثابت للهدف، وليس socketId:

    const target = { roomId, targetUserId };

    socket.emit("banUser", { ...target, reason: "Spam" });
    socket.emit("unbanUser", target);
    socket.emit("removeUser", { ...target, reason: "Disruption" });
    socket.emit("promoteTemporaryModerator", target);
    socket.emit("promoteFixedModerator", target);
    socket.emit("demoteFixedModerator", target);
    socket.emit("muteMic", target);
    socket.emit("unmuteMic", target);

    socket.emit("lockMessages", { roomId });
    socket.emit("unlockMessages", { roomId });

يستقبل المنفذ moderationResult للنجاح والفشل، وفيه action وsuccess وcode وmessage وroomId وقد يوجد targetUserId أو role، وتوجد لقطة state للأوامر المحفوظة. لا توجد callbacks؛ لا تنتظروا callback من emit.

قواعد الأدوار الحالية:
- يحدد Laravel مالك الغرفة ويحمل الأدوار fixed المحفوظة.
- مالك الغرفة وحده يستطيع ترقية أو خفض مشرف fixed.
- يستطيع owner وfixed وroot المحلي ترقية temporary؛ ويجب أن يكون الهدف حاضرًا وأن تحمل كل اتصالاته النشطة JWT صالحًا.
- ينتهي دور temporary عند مغادرة أو انقطاع آخر socket للمستخدم.
- يحفظ Laravel دور fixed ويستمر بعد إعادة تشغيل Node.
- لا تتجاوز معرفات root في SOCKET_ROOT_MODERATOR_IDS صلاحيات Laravel للأوامر المحفوظة.
- لا تمنح حقول الدور القادمة من العميل أي صلاحية.

يحفظ Laravel banUser قبل فصل اتصالات الهدف النشطة وإرسال kicked. ويرفض Laravel الانضمام اللاحق ما دام الحظر فعالًا. يحفظ Laravel unbanUser ولا يعيد اتصال المستخدم تلقائيًا. أما removeUser فيطرد دون حفظ حظر.

## 9. التعامل مع الأخطاء والحالة

معالجة الأخطاء المعتادة:

    socket.on("messageRejected", ({ code, message }) => showMessageError(code, message));
    socket.on("micRequestRejected", ({ code, message }) => showMicError(code, message));
    socket.on("micRejected", ({ code, message }) => showMicError(code, message));
    socket.on("micLeaveRejected", ({ code, message }) => showMicError(code, message));
    socket.on("giftRejected", ({ code, message }) => showGiftError(code, message));

أخطاء الإشراف تصل عبر moderationResult. من الأكواد الشائعة NOT_IN_ROOM وINVALID_MIC_SPOT وMIC_MUTED وMESSAGES_LOCKED وFORBIDDEN وSELF_TARGET وINSUFFICIENT_ROLE وTARGET_NOT_IN_ROOM وTARGET_NOT_AUTHENTICATED.

Laravel هو المصدر الدائم للحظر ورتب fixed وكتم المايك وقفل الرسائل. يعيد كل انضمام تحميل هوية المستخدم وحالة الغرفة المصرح بها. تبقى ترقية temporary وعضوية الاتصالات ومقاعد المايك في ذاكرة Node وتضيع عند إعادة التشغيل. لا تتشارك عمليات Node المتعددة بث Socket.IO الحي حاليًا.

## 10. مواصفات كل حدث

للحمولات والمخرجات والحالات الطرفية لكل حدث، راجعوا:

- rooms/joinRoom.md وrooms/requestMic.md وrooms/leaveMic.md وrooms/audioData.md
- users/leaveRoom.md وusers/disconnect.md
- chat/sendMessage.md وgifts/sendGift.md
- moderation/common.md وصفحات أحداث moderation الأخرى

## نطاق المصدر

تمت مراجعة هذا الدليل مقابل handlers والخدمات والتحقق تحت socket/. لا يشمل demo/.


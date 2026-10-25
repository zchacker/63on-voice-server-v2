# Socket.IO API لمطور الواجهة

هذا الدليل يشرح أحداث Socket.IO الحالية مع حقول الإدخال والإخراج. أسماء الأحداث والحقول البرمجية حساسة لحالة الأحرف.

## الاتصال والمصادقة

- العنوان: http://<HOST>:<PORT> أو https://<HOST>:<PORT>، والمنفذ الافتراضي 3000.
- أرسل JWT في handshake عبر auth.token، وليس في عنوان URL.
- الاتصال العادي دون token مسموح حاليًا. صلاحيات الإشراف تتطلب JWT موقعًا بخوارزمية HS256، ويجب أن يحمل sub معرف المستخدم.
- إعدادات الخادم: SOCKET_JWT_SECRET لسر التوقيع، وSOCKET_ROOT_MODERATOR_IDS لقائمة معرفات مشرفي الجذر مفصولة بفواصل.
- عند وجود JWT صالح، يعتمد الخادم sub كمعرف للمستخدم ويستبدل به user.userId المرسل في joinRoom.
- يوصى بإرسال JWT لكل مستخدم لضمان هوية موثوقة للحظر والكتم. الاتصال دون JWT لا يحصل على صلاحية مشرف.

مثال اتصال:

    import { io } from "socket.io-client";
    const socket = io("https://<HOST>", { auth: { token: "<HS256-JWT>" } });

يجب أن يحتوي JWT على sub. يمكن أيضًا أن يحتوي exp وnbf. رفض التوكن يظهر للعميل في connect_error.

## تنسيق الردود

الأحداث الحالية لا تستخدم callbacks أو Socket.IO acknowledgements. تصل النتيجة كحدث منفصل. أخطاء كثيرة تستخدم الشكل:

    { "code": "ERROR_CODE", "message": "Readable explanation" }

## أحداث الغرفة والمايك

| الحدث المرسل من العميل | الإدخال | النجاح وأحداث الخادم | الخطأ |
| --- | --- | --- | --- |
| joinRoom | { roomId: string, user: { userId: string, name?: string, avatar?: string, ... } } | يبث الخادم userList وmicUpdate، ويرسل للمنضم roleUpdated وmessageLockUpdated. | joinRoomRejected { code, message } |
| leaveRoom | بلا حمولة | يبث userList وmicUpdate عند تغير المقاعد. تنتهي رتبة المشرف المؤقت بعد مغادرة آخر اتصال له. | لا يوجد رد خطأ معرف حاليًا. |
| requestMic | { spotNumber: integer } من 0 إلى 7 | للطالب takeMic { spotNumber }، وللغرفة micUpdate. | micRequestRejected { code, message } أو micRejected عند انشغال المقعد. |
| leaveMic | { spotNumber: integer } من 0 إلى 7 | للطالب leaveMic { spotNumber }، وللغرفة micUpdate. | micLeaveRejected { code, message } |
| audioData | أي حمولة يقبلها Socket.IO | أعضاء الغرفة الآخرون يستقبلون audioData { userId, audio }. | audioDataRejected { code, message } |
| sendMessage | أي قيمة غير null؛ يفضل كائن رسالة متفق عليه | أعضاء الغرفة يستقبلون newMessage { message, user }. | messageRejected { code, message } |
| sendGift | أي حمولة هدية يتفق عليها التطبيق | أعضاء الغرفة يستقبلون sendGift { gift, user }. | giftRejected { code, message } |

مثال:

    socket.emit("joinRoom", {
      roomId: "room-123",
      user: { userId: "user-42", name: "Sara", avatar: "https://example.com/sara.png" }
    });
    socket.emit("requestMic", { spotNumber: 2 });
    socket.emit("sendMessage", { id: "msg-1", text: "Hello" });
    socket.emit("sendGift", { id: "gift-1", name: "Rose" });

userList مصفوفة مستخدمين، يضيف الخادم لكل منهم socketId. استخدم userId كمعرف ثابت للتطبيق؛ socketId خاص باتصال واحد. micUpdate كائن مفاتيحه أرقام المقاعد وقيمه كائنات المستخدمين. الخادم لا يفرض مخططًا ثابتًا لكائن الرسالة أو الهدية.

## أحداث الإشراف

يجب أن يكون منفذ الأمر عضوًا في roomId وأن يحمل JWT صالحًا. يستقبل المنفذ moderationResult بهذا الشكل:

    {
      "action": "banUser",
      "success": true,
      "code": "OK",
      "message": "Action completed.",
      "roomId": "room-123",
      "targetUserId": "user-42"
    }

عند الفشل تكون success=false ويشرح code وmessage السبب. يتضمن الرد role عند الترقية. لا يستطيع العميل منح رتبة لنفسه عبر كائن user؛ الخادم يحدد الدور من حالة الإشراف وهوية JWT.

| الحدث المرسل | الإدخال | أحداث النجاح |
| --- | --- | --- |
| banUser | { roomId, targetUserId, reason? } | المنفذ يستقبل moderationResult؛ المستهدف يستقبل kicked { roomId, userId, reason }؛ الغرفة تستقبل userBanned { roomId, userId } وuserList وmicUpdate. محاولة الدخول اللاحقة ترفض عبر joinRoomRejected. |
| unbanUser | { roomId, targetUserId } | moderationResult؛ الغرفة تستقبل userUnbanned { roomId, userId }. |
| removeUser | { roomId, targetUserId, reason? } | طرد دون تسجيل حظر؛ moderationResult وkicked وuserRemoved { roomId, userId } وuserList وmicUpdate. |
| promoteTemporaryModerator | { roomId, targetUserId } | moderationResult مع role="temporary"؛ للمستخدم roleUpdated وللغرفة moderatorUpdated. يجب أن يكون الهدف حاضرًا. |
| promoteFixedModerator | { roomId, targetUserId } | مثل الترقية المؤقتة مع role="fixed". مشرف الجذر فقط يستطيع منحها. تبقى بعد مغادرة الغرفة حتى تتوقف عملية الخادم. |
| muteMic | { roomId, targetUserId } | moderationResult؛ للهدف micMuted { roomId, userId }؛ للغرفة micModerationUpdated { roomId, userId, muted: true } وmicUpdate. |
| unmuteMic | { roomId, targetUserId } | moderationResult؛ للهدف micUnmuted { roomId, userId }؛ للغرفة micModerationUpdated { roomId, userId, muted: false }. |
| lockMessages | { roomId } | moderationResult؛ للغرفة messageLockUpdated { roomId, locked: true, changedBy, normalUsersOnly: true }. المستخدم العادي فقط يُمنع من الكتابة، ويستطيع المشرف الكتابة. |
| unlockMessages | { roomId } | moderationResult؛ للغرفة messageLockUpdated { roomId, locked: false, changedBy, normalUsersOnly: false }. |

حقول moderationResult الأساسية: action وsuccess وcode وmessage وroomId. قد يغيب targetUserId عند قفل الرسائل.
تُرسل أحداث الهدف إذا كان متصلًا. عند دخول مستخدم مكتوم للغرفة، يستقبل micMuted مرة أخرى حتى يحدّث الواجهة حالته.

أمثلة أوامر واستقبال الرد:

    socket.emit("banUser", { roomId: "room-123", targetUserId: "user-42", reason: "Spam" });
    socket.emit("promoteTemporaryModerator", { roomId: "room-123", targetUserId: "user-43" });
    socket.emit("promoteFixedModerator", { roomId: "room-123", targetUserId: "user-44" });
    socket.emit("muteMic", { roomId: "room-123", targetUserId: "user-42" });
    socket.emit("unmuteMic", { roomId: "room-123", targetUserId: "user-42" });
    socket.emit("lockMessages", { roomId: "room-123" });
    socket.emit("unlockMessages", { roomId: "room-123" });

    socket.on("moderationResult", (result) => {
      if (!result.success) showError(result.message);
    });
    socket.on("messageLockUpdated", ({ locked }) => updateChatLock(locked));
    socket.on("roleUpdated", ({ role }) => updateMyRole(role));
    socket.on("micMuted", () => stopPublishingAudio());
    socket.on("kicked", () => leaveRoomView());

## الرتب والصلاحيات

- root: معرفه ضمن SOCKET_ROOT_MODERATOR_IDS ولديه JWT صالح مطابق لـ sub. يستطيع تنفيذ الإشراف وترقية مشرف ثابت.
- fixed: مشرف ثابت؛ يستطيع الإشراف وترقية مشرف مؤقت.
- temporary: يستطيع الحظر والطرد وكتم وفتح المايك وقفل وفتح الرسائل؛ لا يستطيع ترقية مشرفين.
- normal: مستخدم عادي.

لا يمكن إدارة مشرف الجذر. المشرف الثابت محمي من المشرفين الثابتين والمؤقتين، ويستطيع الجذر إدارة الأدوار الأخرى. لا يمكن تغيير المشرف الثابت إلى مؤقت. reason اختياري ويقصه الخادم إلى 300 حرف عند التخزين.

## التخزين والسلوك الحالي

الحظر والرتب وكتم المايك وقفل الرسائل محفوظة حاليًا في ذاكرة عملية Node.js. تبقى الرتبة الثابتة بعد مغادرة الغرفة، وتظل الحالات موجودة ما دامت العملية تعمل؛ لكنها تضيع عند إعادة تشغيل الخادم. socket/moderation/moderation.state.js هو حد التخزين الذي يمكن استبداله لاحقًا بتكامل Laravel. سيبقى عقد أحداث الواجهة كما هو، لكن الحفظ بين مرات التشغيل يتطلب تنفيذ هذا التكامل.

الخادم يتحقق من توقيع JWT للمشرف. يوصى بإرسال JWT لكل المستخدمين. يسمح الخادم حاليًا بدخول جلسات بلا JWT كمستخدم عادي، لذلك لا تعتمد على الحظر لهوية غير موثقة؛ ولا يمكن لهذه الجلسات الحصول على صلاحيات مشرف.

## رموز الأخطاء

- AUTHENTICATION_FAILED: رفض JWT أثناء الاتصال.
- FORBIDDEN: لا يملك المنفذ رتبة كافية.
- NOT_IN_ROOM: يجب الانضمام للغرفة أولًا.
- INVALID_MIC_SPOT: يجب أن يكون رقم المايك عددًا صحيحًا بين 0 و7.
- MIC_MUTED: كتم المشرف يمنع طلب المايك وإرسال audioData.
- MESSAGES_LOCKED: الدردشة مقفلة للمستخدم العادي.
- TARGET_NOT_IN_ROOM: الترقية المؤقتة تتطلب وجود الهدف.
- TARGET_NOT_AUTHENTICATED: الترقية المؤقتة تتطلب جلسة JWT موثقة للهدف.
- USER_NOT_BANNED: لا يوجد حظر لإلغائه.

## أحداث يفضّل للواجهة الاستماع لها

    socket.on("userList", (users) => renderUsers(users));
    socket.on("micUpdate", (spots) => renderMicSpots(spots));
    socket.on("newMessage", ({ message, user }) => appendMessage(user, message));
    socket.on("sendGift", ({ gift, user }) => showGift(user, gift));
    socket.on("audioData", ({ userId, audio }) => playAudio(userId, audio));
    socket.on("moderatorUpdated", ({ userId, role }) => updateRoomMemberRole(userId, role));
    socket.on("micModerationUpdated", ({ userId, muted }) => updateMemberMute(userId, muted));
    socket.on("userBanned", ({ userId }) => removeMember(userId));
    socket.on("userUnbanned", ({ userId }) => refreshBanState(userId));
    socket.on("userRemoved", ({ userId }) => removeMember(userId));
    socket.on("connect_error", (error) => showConnectionError(error.message));

# أحداث الخادم المرسلة للعميل

الحمولات التالية مطابقة للكود الحالي.

| الحدث | المستلم | الحمولة أو السلوك |
| --- | --- | --- |
| userList | الغرفة | عنصر لكل اتصال، ويشمل userId وname وavatar الموثوقة من Laravel وsocketId. يتجاهل الخادم حقول الملف الشخصي المرسلة من العميل. |
| micUpdate | الغرفة | كائن مفاتيحه أرقام مقاعد المايك وقيمه كائن المستخدم المحجوز. {} تعني أن كل المقاعد متاحة. |
| roleUpdated | المستخدم المنضم أو الذي تغير دوره | { roomId, userId, role } حيث role إحدى owner أو root أو fixed أو temporary أو normal. |
| messageLockUpdated | المنضم أو الغرفة | { roomId, locked, normalUsersOnly }؛ عند الانضمام تساوي normalUsersOnly قيمة locked. |
| micMuted | المستخدم المستهدف | { roomId, userId }؛ يعاد إرساله للمستخدم المكتوم عند دخوله. |
| micUnmuted | المستخدم المستهدف | { roomId, userId }. |
| takeMic | طالب المايك | { spotNumber }. |
| leaveMic | من حرر المايك | { spotNumber }. |
| micRejected | طالب المايك | { code: "MIC_SPOT_TAKEN", message }. |
| micRequestRejected | طالب المايك | { code, message }؛ مثل NOT_IN_ROOM وINVALID_MIC_SPOT وMIC_MUTED. |
| micLeaveRejected | طالب ترك المايك | { code, message }؛ مثل NOT_IN_ROOM وINVALID_MIC_SPOT وMIC_SPOT_NOT_OWNED. |
| audioData (legacy) | بقية sockets في الغرفة نفسها | { userId, audio }؛ userId معرف التطبيق وaudio هي الحمولة المرسلة. |
| audioDataRejected (legacy) | مرسل الصوت | { code, message }؛ NOT_IN_ROOM أو MIC_MUTED. |
| newMessage | الغرفة | { message, user }. |
| messageRejected | مرسل الرسالة | { code, message }؛ NOT_IN_ROOM أو MESSAGES_LOCKED أو INVALID_MESSAGE. |
| sendGift | الغرفة | { gift, user }. |
| giftRejected | مرسل الهدية | { code: "NOT_IN_ROOM", message }. |
| joinRoomRejected | طالب الانضمام | { roomId, userId, code, message }؛ لأخطاء JWT أو رفض Laravel أو إعداد الخادم. |
| kicked | المستخدم المطرود | { roomId, userId, reason }؛ يمكن أن تكون reason مساوية null. |
| userBanned | الغرفة | { roomId, userId }. |
| userUnbanned | الغرفة | { roomId, userId }. |
| userRemoved | الغرفة | { roomId, userId }. |
| moderatorUpdated | الغرفة | { roomId, userId, role }. |
| micModerationUpdated | الغرفة | { roomId, userId, muted }. |
| roomUpdated | الغرفة | { roomId, title?, image?, country?, description? }؛ الحقول العامة المتغيرة فقط. |
| moderationResult | المشرف الذي أرسل الطلب | { action, success, code, message, roomId, targetUserId?, role?, state?, requestId, occurredAt }. إذا لم يرسل العميل UUID ينشئ Node قيمة requestId. |

أخطاء الاتصال يرسلها Socket.IO نفسه كحدث client-side اسمه connect_error، وليست أحداثًا يطلقها handler في التطبيق.
لا توجد أحداث تطبيق باسم userJoined أو userLeft.

## المصدر

ملفات events.js داخل socket والموديولات التي تستدعيها.

يستخدم نقل الصوت [LiveKit](livekit.md). حدثا audioData أعلاه قديمان باقِيان في المصدر ولا تستخدمهما الواجهة الحالية. اربطوا takeMic وleaveMic وmicMuted وkicked بإجراءات LiveKit SDK المناسبة.

تحافظ userBanned وuserUnbanned على الحمولة الحالية `{ roomId, userId }`، ولا تبثان إلا بعد تأكيد Laravel حفظ الأمر. يصل kicked بعد إخراج الهدف من غرفة Socket.

# تكليف فريق Laravel: ربط Sanctum بسوكيت الصوت وحفظ الإشراف

مرجع عقد التكامل: نفّذ فريق Laravel واجهات التكامل الموثقة حاليًا في API_REFERENCE.md. تم ربط خادم Node بهذه الواجهات؛ احتفظوا بهذا الملف كقائمة مطابقة للعقد، وحدّثوا API_REFERENCE.md إذا تغيّرت الحقول أو الأكواد.

## سياق المشروع الحالي

خادم Socket.IO في مشروع 63on-voice-server-v2 يستخدم حاليًا:
- اتصال Socket.IO مع حدث joinRoom وحقل userId.
- يتحقق Node من HS256 وsub وiat وjti وexp وiss وaud وnbf الاختياري في JWT؛ ويلزم التوكن لدخول الغرفة.
- يستدعي Node authorize-join قبل الانضمام ويعتمد هوية المستخدم وحالة الغرفة المعادة من Laravel.
- تُحفظ أوامر الحظر والأدوار الثابتة وكتم المايك وقفل الرسائل عبر Laravel؛ يحتفظ Node بنسخة تشغيلية مؤقتة.
- تبقى الأدوار المؤقتة ومقاعد المايك والاتصالات الحية داخل ذاكرة Node.
- ملفات API الحالية: FRONTEND_SOCKET_API.md وFRONTEND_SOCKET_API.en.md.

توكن Sanctum الذي يستلمه العميل ليس JWT متوافقًا مع middleware الحالي. لا ترسلوه إلى الخادم على أنه JWT وتتوقعوا أن يتحقق منه محليًا. في API tokens يخزن Sanctum بصمة SHA-256 في قاعدة البيانات ويعيد قيمة التوكن الصريحة للعميل عند إنشائه. كما أن Sanctum SPA قد يستخدم session cookies بدل توكن API. راجعوا إصدار Laravel المستخدم لتأكيد الإعداد الفعلي.

## المطلوب من فريق Laravel

### 1. توحيد طريقة إصدار هوية السوكيت

استخدموا auth:sanctum للتحقق من جلسة المستخدم الحالية، سواء كان المشروع يستخدم Sanctum bearer token أو نمط SPA المدعوم لديه. أضيفوا endpoint:

    POST /api/socket/session

طلب العميل:
- Bearer Sanctum token في Authorization إذا كان نمط التطبيق يستخدم API tokens.
- أو جلسة/cookie Sanctum إذا كان التطبيق SPA ويستخدمها حاليًا.
- لا يقبل endpoint userId أو role من body كمصدر للهوية.

استجابة مقترحة:

    {
      "socket_token": "<short-lived-HS256-JWT>",
      "token_type": "Bearer",
      "expires_in": 600,
      "user": {
        "id": "user-42",
        "name": "Sara",
        "avatar": "https://example.com/avatar.png"
      }
    }

أنشئوا JWT مخصصًا للسوكيت بتوقيع HS256 وسر منفصل مخصص مشترك بين Laravel وNode، ولا تعيدوا استخدام قيمة سرية مرئية للواجهة. الclaims المطلوبة في Node:
- Header alg=HS256 وtyp=JWT.
- sub نصّي ويساوي user.id.
- iat وexp بتوقيت Unix بالثواني، وjti نص غير فارغ.
- iss وaud يطابقان إعداد Node.
- nbf اختياري ويُفحص عند وجوده.
- مدة التوكن لا تتجاوز 10 دقائق.

تتحقق نسخة Node الحالية من iat وiss وaud وjti بالإضافة إلى sub وexp، وتفحص nbf عند وجوده. القيم الافتراضية للمُصدر والجمهور هي 63on-backend و63on-socket؛ اضبطوا SOCKET_JWT_ISSUER وSOCKET_JWT_AUDIENCE في Node إذا غيّر Laravel الإعدادات. مدة 5 إلى 10 دقائق مناسبة كبداية، ويطلب العميل جلسة جديدة من Laravel قبل انتهاء التوكن ثم يعيد الاتصال بتوكن جديد.

لا يقرأ Node جداول Sanctum مباشرة ولا يقبل Sanctum token بدل JWT السوكيت. لا ترسلوا توكن المستخدم أو سر التوقيع في السجلات.

### 2. التحقق من صلاحية الانضمام وجلب حالة الغرفة

أضيفوا endpoint داخليًا لا يستدعيه إلا خادم Node بعد التحقق من JWT:

    POST /api/internal/socket/v1/rooms/{roomId}/authorize-join

يجب حماية هذا المسار بمصادقة خدمة إلى خدمة، مثل bearer service token مستقل أو mTLS. لا تستخدموا Sanctum token الخاص بالمستخدم كاعتماد لخادم Node، ولا تتيحوا هذا المسار للواجهة.

طلب Node المقترح:

    {
      "userId": "user-42",
      "connectionId": "socket-id-from-node"
    }

يستخرج Node userId من claim sub في JWT الموثق، ولا يأخذه من userId يرسله العميل. على Laravel التحقق من:
- أن الغرفة موجودة ونشطة.
- أن المستخدم يحق له الانضمام وفق سياسة الغرفة: عامة، خاصة، مدعو إليها، أو أي قاعدة موجودة في التطبيق.
- أن المستخدم غير محظور من الغرفة.
- مالك الغرفة والمشرفين الثابتين.
- حالة كتم المايك وقفل رسائل العاديين.

استجابة نجاح مقترحة:

    {
      "allowed": true,
      "room": {
        "id": "room-123",
        "ownerId": "user-owner",
        "messagesLocked": true
      },
      "user": {
        "id": "user-42",
        "name": "Sara",
        "avatar": "https://example.com/avatar.png"
      },
      "role": "owner",
      "moderation": {
        "banned": false,
        "micMuted": false
      }
    }

استجابة رفض مقترحة، مع HTTP 403 أو 404 حسب سياسة كشف وجود الغرف:

    {
      "allowed": false,
      "code": "USER_BANNED",
      "message": "The user is banned from this room."
    }

استخدموا أكواد مستقرة مثل ROOM_NOT_FOUND وROOM_INACTIVE وJOIN_NOT_ALLOWED وUSER_BANNED. على Node رفض joinRoom قبل إدخال socket في غرفة Socket.IO إذا allowed=false، ثم يرسل joinRoomRejected للعميل. لا تعتمدوا على كائن user القادم من الواجهة لتعريف الاسم أو الدور أو صلاحية الدخول؛ اعتمدوا على بيانات الاستجابة الموثقة.

### 3. حفظ أوامر الإشراف في Laravel

أضيفوا endpoint داخليًا موحدًا للأوامر، أو endpoints منفصلة مع نفس السلوك. المقترح الموحد:

    POST /api/internal/socket/v1/rooms/{roomId}/moderation/commands

طلب من Node بعد التحقق المحلي من صلاحية actor:

    {
      "requestId": "uuid-for-idempotency",
      "action": "ban",
      "actorUserId": "user-owner",
      "actorRole": "owner",
      "targetUserId": "user-42",
      "reason": "Spam"
    }

قائمة actions المطلوبة:
- ban
- unban
- promote_fixed
- demote_fixed
- mute_mic
- unmute_mic
- lock_messages
- unlock_messages

لا تحفظوا temporary moderator كرتبة ثابتة. تبقى مؤقتة في Socket.IO وتنتهي عند مغادرة آخر اتصال للمستخدم للغرفة. أوامر kick/removeUser فقط تخرج المستخدم من الاتصال ولا تضيف سجل حظر.

يجب تنفيذ التحقق والصلاحيات داخل Laravel أيضًا قبل التعديل:
- owner وfixed moderator يستطيعان ban/unban وkick حسب سياسة المنتج، وإدارة mute/chat lock.
- temporary moderator يستطيع تنفيذ العمليات التشغيلية المسموحة له حسب سياسة المنتج لكنه لا يستطيع منح fixed moderator.
- ترقية fixed moderator أو إزالتها لصاحب الغرفة فقط، أو لرتبة إدارية أخرى تحددونها صراحة.
- لا يستطيع المستخدم استهداف نفسه، ولا يستطيع fixed moderator إدارة owner أو fixed moderator آخر إلا إذا قررت سياسة Laravel خلاف ذلك.
- actorRole في الطلب موثوق فقط لأنه يأتي من خدمة Node موثقة. لا تقبلوا هذا الحقل من frontend.

استجابة نجاح مقترحة:

    {
      "requestId": "same-uuid",
      "success": true,
      "code": "OK",
      "roomId": "room-123",
      "action": "ban",
      "actorUserId": "user-owner",
      "targetUserId": "user-42",
      "state": {
        "banned": true,
        "role": "normal",
        "micMuted": false,
        "messagesLocked": true
      }
    }

استجابة رفض مقترحة:

    {
      "requestId": "same-uuid",
      "success": false,
      "code": "FORBIDDEN",
      "message": "Insufficient permission."
    }

استخدموا معاملات قاعدة بيانات وقيود uniqueness لمنع التكرار، واعتبروا requestId مفتاح idempotency حتى لا يكرر reconnect نفس الأمر. يجب على Node ألا يبث نجاحًا للمستخدمين قبل موافقة Laravel. إذا تعذر الاتصال بـLaravel عند أمر حساس، افشلوا مغلقًا: ارفضوا الأمر ولا تعاملوا الذاكرة المؤقتة كأنها حفظ دائم.

### 4. نموذج البيانات المطلوب

كيّفوا الأسماء مع schema المشروع الحالي بدل إنشاء جداول مكررة. الحد الأدنى من البيانات:
- rooms.owner_id أو العلاقة الحالية التي تحدد مالك الغرفة.
- room_bans: room_id، user_id، banned_by، reason، created_at، revoked_at/active. قيد يمنع أكثر من حظر نشط لنفس المستخدم والغرفة.
- room_moderators: room_id، user_id، role ثابت، granted_by، created_at، updated_at. قيد فريد على room_id وuser_id.
- حالة المايك المكتوم لكل غرفة ومستخدم إذا كانت الميوتات يجب أن تبقى بعد المغادرة.
- messages_locked على الغرفة أو سجل policy إذا كان قفل الرسائل يجب أن يبقى بعد إعادة التشغيل.

يفضل استخدام علاقة أو سجل تاريخي عند إلغاء الحظر أو تغيير دور المشرف كي يبقى audit trail يتضمن المنفذ والوقت والسبب. لا تخزنوا Socket.IO socketId كمعرف مستخدم دائم.

## طريقة الربط المتوقعة في Node

1. العميل يسجل الدخول إلى Laravel ويستلم Sanctum credential الحالي.
2. العميل يطلب POST /api/socket/session، ويستلم socket_token قصير العمر.
3. العميل يفتح Socket.IO ويرسل socket_token في handshake.auth.token.
4. Node يتحقق من توقيع JWT ويستخرج sub.
5. عند joinRoom، يطلب Node authorize-join من Laravel باستخدام اعتماد خدمة Node، ثم يعتمد بيانات user/role/state من جواب Laravel.
6. عند كل أمر إشراف قابل للحفظ، يرسل Node moderation command إلى Laravel.
7. بعد استجابة النجاح فقط، يحدّث Node الحالة المؤقتة اللازمة ويذيع أحداث Socket.IO الموثقة في FRONTEND_SOCKET_API.md وFRONTEND_SOCKET_API.en.md.
8. عند عودة Node بعد restart، تجلب حالة الغرفة والمستخدم من authorize-join بدل الاعتماد على الذاكرة القديمة.

## ما نحتاجه منكم قبل الدمج

أرسلوا إلى فريق Node:
- إصدار Laravel وSanctum المستخدم، ونمط الدخول الفعلي: bearer personal access tokens أم SPA cookies.
- هل كل غرفة عامة أم توجد قواعد عضوية/خصوصية؟ وما قاعدة السماح الحالية للانضمام؟
- ملف OpenAPI أو أمثلة request/response النهائية لكل endpoint، مع أكواد HTTP وأكواد الخطأ.
- claim mapping لمعرف المستخدم، وقيم iss/aud، ومدة JWT وتجديده.
- تطابق SOCKET_JWT_SECRET وSOCKET_INTERNAL_SERVICE_TOKEN بين Laravel وNode، وإعداد SOCKET_LARAVEL_API_BASE_URL على Node؛ لا تنشروا القيم في Git أو تطبيق العميل.
- اسم هوية المالك والمشرفين الثابتين في قاعدة البيانات، وسياسة الصلاحيات لكل action.
- migrations، policies/services، اختبارات Laravel، وآلية audit للحظر والترقيات.
- بيئة staging وعنوان داخلي يمكن لـNode الوصول إليه، مع بيانات اختبار غير إنتاجية.
- آلية إلغاء/حذف fixed moderator، فك الحظر، وفك الميوت عند الحاجة.

## شروط القبول

- تزوير userId أو role في joinRoom لا يغير هوية المستخدم ولا يمنحه صلاحية.
- لا يستطيع المستخدم الانضمام إلى غرفة محظور منها أو غير مسموح له بدخولها.
- مالك غرفة A لا يحصل تلقائيًا على صلاحيات في غرفة B.
- الحظر والترقية الثابتة والميوت وقفل الرسائل تستمر بعد إعادة تشغيل Node إذا اختير تخزينها الدائم.
- temporary moderator يعود normal بعد مغادرة آخر اتصال للغرفة ولا يظهر كرتبة دائمة في Laravel.
- كل أمر إداري يتحقق من actor وroom وtarget في Laravel، ويسجل المنفذ والوقت.
- فشل Laravel أو timeout لا يؤدي إلى بث نجاح غير محفوظ.
- لا تظهر Sanctum tokens أو JWT signing secrets في logs أو responses غير المقصودة.

## مراجع المشروع

- API الواجهة العربية: FRONTEND_SOCKET_API.md
- API الواجهة الإنجليزية: FRONTEND_SOCKET_API.en.md
- سياق المشروع وحدود الموديولات: AI_CONTEXT.md
- نقطة حالة الإشراف الحالية في Node: socket/moderation/moderation.state.js

مرجع Sanctum الرسمي: https://laravel.com/docs/sanctum. توكنات API الشخصية لدى Sanctum تستخدم بيانات توكن محفوظة في قاعدة البيانات، وتعيد قيمة plainTextToken عند الإنشاء؛ وهي ليست JWT.

## توضيح نقل الصوت

الصوت الفعلي عبر LiveKit على livekit.63on.com. يصدر POST /api/room/join توكن LiveKit مستقلًا عن socket_token الصادر من /api/socket/session. أحداث Node تنسق حالة التطبيق ومقاعد المايك؛ audioData ناقل قديم غير مستخدم في التطبيق. راجعوا [دليل LiveKit العربي](docs/socket-api/ar/livekit.md) لربط room.id مع room.username وحدود فرض الكتم والحظر الحالية.

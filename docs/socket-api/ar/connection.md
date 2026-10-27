# اتصال Socket.IO والمصادقة

## الاتصال

استخدم عنوان HTTP(S) الخاص بالخادم. المنفذ الافتراضي 3000 ويمكن تغييره بواسطة PORT. يتولى Socket.IO التفاوض على وسيلة النقل.

    import { io } from "socket.io-client";
    const socket = io("https://<SOCKET_HOST>", {
      auth: { token: socketJwt }
    });

## الحصول على JWT السوكيت من Laravel

بعد تسجيل الدخول إلى Laravel، استدعِ POST /api/socket/session ببيانات مصادقة Sanctum الخاصة بالمستخدم. يعيد Laravel قيمة socket_token قصيرة العمر. توكن Sanctum ليس JWT ولا يجوز إرساله بدلًا من JWT السوكيت.

يرسل العميل JWT المعاد في auth.token ضمن handshake. يتحقق Node من:
- Header JWT يحتوي alg=HS256 وtyp=JWT.
- توقيع HMAC-SHA256 باستخدام SOCKET_JWT_SECRET.
- claim sub نصي وغير فارغ.
- iat وexp عددان صحيحان بتوقيت Unix بالثواني، وjti نص غير فارغ.
- exp صالح في المستقبل كتوقيت Unix بالثواني.
- iss وaud؛ القيم الافتراضية 63on-backend و63on-socket. اضبط SOCKET_JWT_ISSUER وSOCKET_JWT_AUDIENCE في Node إذا غيّر Laravel إعداداتهما.
- claim nbf إذا وُجد.

يرفض الاتصال عند توقيع أو claims غير صالحة برسالة connect_error تبدأ بـ AUTHENTICATION_FAILED. يفصل الخادم الاتصال عند exp ويرفض أي أحداث بعد انتهاء التوكن. قد يفتح الاتصال دون JWT، لكن لا يمكنه الانضمام إلى غرفة.

## هوية الانضمام والتحقق من الصلاحية

يرسل العميل joinRoom مع roomId. يمكن إرسال بيانات user القديمة للتوافق، لكن الخادم يتجاهلها. يأخذ Node معرف المستخدم من claim sub الموثق، ثم يستدعي Laravel عبر POST /api/internal/socket/v1/rooms/{roomId}/authorize-join باستخدام اعتماد خدمة خاص بالخوادم. لا ينضم الاتصال إلا بعد أن يعيد Laravel allowed=true ومعرف مستخدم مطابقًا لـsub.

Laravel هو مصدر بيانات الملف الشخصي الموثوق والدور الثابت والحظر وكتم المايك وقفل رسائل الغرفة. لا تمنح الحقول المرسلة من العميل مثل userId أو role أو isModerator أو permissions هوية أو صلاحية.

## إعدادات الخادم

اضبط هذه المتغيرات في خادم Node:
- SOCKET_JWT_SECRET: القيمة نفسها الموجودة في Laravel، ويجب أن تكون عشوائية وبطول 32 محرفًا على الأقل.
- SOCKET_INTERNAL_SERVICE_TOKEN: القيمة نفسها في Laravel، مختلفة عن سر JWT وبطول 32 محرفًا على الأقل.
- SOCKET_LARAVEL_API_BASE_URL: أصل Laravel فقط، مثل https://api.example.com، دون /api.
- SOCKET_JWT_ISSUER وSOCKET_JWT_AUDIENCE: القيم نفسها في Laravel؛ القيم الافتراضية موضحة أعلاه.
- SOCKET_LARAVEL_REQUEST_TIMEOUT_MS: اختياري، الافتراضي 5000، والنطاق المقبول 100 إلى 30000.

يقرأ خادم Socket ملف .env الخاص بالمشروع عبر محمّل Node المدمج عند توفره. أبقِ .env خارج Git. لا ترسل أيًا من السرّين إلى تطبيق الهاتف أو الويب. توجد أسماء الإعدادات في .env.example.

SOCKET_ROOT_MODERATOR_IDS قائمة مفصولة بفواصل لمعرفات root المحلية. لا تتجاوز رتبة root قرار Laravel في الأوامر المحفوظة؛ يجب أن يتعرف Laravel على المنفذ كمالك للغرفة أو مشرف ثابت أو temporary مسموح له.

## المصدر

socket/auth/socket.auth.js وsocket/rooms/room.service.js وsocket/rooms/room.validation.js وservices/laravel.service.js.

## اتصال الصوت المستقل

ينقل LiveKit الصوت عبر wss://livekit.63on.com. يأتي توكنه من Laravel POST /api/room/join داخل data.token. JWT الصادر من /api/socket/session مخصص لسوكيت التطبيق. راجعوا [دليل LiveKit](livekit.md).

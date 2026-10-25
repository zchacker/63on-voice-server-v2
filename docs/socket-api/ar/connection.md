# اتصال Socket.IO والمصادقة

## الاتصال

استخدم عنوان HTTP(S) الخاص بالخادم. المنفذ الافتراضي 3000 ويمكن تغييره بواسطة PORT. Socket.IO يتولى التفاوض على وسيلة النقل.

    import { io } from "socket.io-client";
    const socket = io("https://<HOST>");

## JWT اختياري في handshake

يمكن للعميل إرسال JWT عبر auth في handshake:

    const socket = io("https://<HOST>", {
      auth: { token: "<JWT>" }
    });

إذا أرسل العميل توكنًا، يتحقق الخادم من:
- Header alg يساوي HS256.
- توقيع HMAC-SHA256 باستخدام SOCKET_JWT_SECRET في بيئة الخادم.
- وجود claim باسم sub نصي وغير فارغ، ويستخدم كـ authenticatedUserId.
- يفحص exp وnbf الاختياريين كتوقيت Unix بالثواني إذا كانت قيمتهما truthy.

التوكن المرسل وغير الصالح يرفض الاتصال. يستقبل العميل connect_error برسالة تحتوي AUTHENTICATION_FAILED. الاتصال دون توكن مسموح حاليًا، لكنه لا يحصل على authenticatedUserId.

## الهوية عند الانضمام

يرسل العميل حدث joinRoom متضمنًا كائن user. عند وجود JWT صالح، يستبدل الخادم user.userId بقيمة sub. دون JWT يجب أن يكون user.userId نصًا غير فارغ، لكنه يأتي من العميل ويمكن تزويره. يحذف الخادم الحقول role وisModerator وpermissions قبل بث المستخدم.

لا يحصل على دور root أو fixed أو temporary إلا اتصال بهوية JWT موثقة. معرفات root تأتي من SOCKET_ROOT_MODERATOR_IDS، وهي قائمة مفصولة بفواصل. وجود JWT وحده لا يمنح دورًا.

## حدود الثقة الحالية

JWT اختياري للانضمام. لا تعتمد على الحظر أو كتم المايك ضد جلسة بلا مصادقة؛ يمكن للعميل ادعاء userId آخر. تكامل Laravel مستقبلي يجب أن يتحقق من Sanctum وعضوية الغرفة قبل نجاح joinRoom.

## المصدر

socket/auth/socket.auth.js وsocket/index.js.

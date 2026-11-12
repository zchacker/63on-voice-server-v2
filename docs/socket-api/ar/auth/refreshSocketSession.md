# refreshSocketSession

**الاتجاه:** من العميل إلى الخادم عبر اتصال Socket.IO موثق وقائم.

## الإدخال

```js
socket.emit('refreshSocketSession', { token: newSocketToken });
```

`token` هو `socket_token` الجديد من Laravel عبر `POST /api/socket/session` باستخدام مصادقة Sanctum للمستخدم الحالي. تطلب الواجهة التوكن قبل انتهاء جلسة Socket الحالية. يتحقق الخادم من التوقيع وكل claims المستخدمة في الاتصال الأول، وتطابق `sub` مع المستخدم الحالي، وأن `exp` الجديد أحدث من المقبول حاليًا. يبقى الحد الأقصى لعمر JWT هو 600 ثانية.

## مخرجات النجاح

يستقبل الاتصال الطالب فقط الحدث `socketSessionRefreshed`.

```json
{
  "userId": "42",
  "expiresAt": 1800000190,
  "expiresIn": 180
}
```

`expiresAt` يساوي `exp` المقبول بتوقيت Unix بالثواني. `expiresIn` هو عدد الثواني المتبقية وقت التأكيد. استخدموا التأكيد لجدولة التجديد القادم قبل الانتهاء بنحو 60 ثانية.

يستبدل الخادم مؤقت الصلاحية على الاتصال الحالي. يستمر socket ID وعضوية الغرفة ومقعد المايك ودور المشرف المؤقت واتصال LiveKit عند نجاح التجديد. يستمر تطبيق صلاحيات الغرفة وأوامر الإشراف كالمعتاد.

## مخرجات الفشل

يستقبل الاتصال الطالب الحدث `socketSessionRefreshRejected`.

```json
{
  "code": "SESSION_IDENTITY_MISMATCH",
  "message": "The new token must belong to the current user."
}
```

| الكود | المعنى |
| --- | --- |
| AUTHENTICATION_REQUIRED | لا توجد جلسة موثقة فعالة. يلزم الاتصال باستخدام توكن صالح في handshake. |
| INVALID_REFRESH_PAYLOAD | يلزم كائن يحتوي `token` كنص غير فارغ. |
| INVALID_SOCKET_TOKEN | التوقيع أو claims غير صالحة، أو انتهى التوكن الجديد. |
| SESSION_IDENTITY_MISMATCH | التوكن يخص مستخدمًا آخر. |
| SESSION_NOT_EXTENDED | `exp` الجديد مساوٍ أو أقدم من الصلاحية الحالية. يشمل ذلك الطلب المكرر أو طلبًا أقدم وصل متأخرًا. |

يبقى التوكن المقبول ومؤقت صلاحيته فعالين عند رفض التجديد. أعيدوا المحاولة بتوكن صحيح أحدث قبل انتهاء المؤقت الحالي. إذا وصلت الحزمة بعد انتهاء الجلسة، يحجبها Middleware المصادقة ويفصل الخادم الاتصال. يتطلب الاتصال المنتهي اتصالًا جديدًا ثم الانضمام إلى الغرفة مجددًا.

## مثال الواجهة

سجلوا المستمعين مرة واحدة قبل إرسال الطلبات. أرسلوا طلب تجديد واحدًا في كل مرة لأن الردود تأتي كأحداث دون request ID أو acknowledgement callback.

```js
socket.on('socketSessionRefreshed', ({ expiresAt, expiresIn }) => {
  // Schedule the next call to renewSocketSession about 60 seconds before expiry.
  onSessionRenewed({ expiresAt, expiresIn });
});

socket.on('socketSessionRefreshRejected', ({ code, message }) => {
  onSessionRenewalError({ code, message });
});

async function renewSocketSession() {
  const response = await fetch(laravelOrigin + '/api/socket/session', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + sanctumToken,
      Accept: 'application/json'
    }
  });
  if (!response.ok) throw new Error('Socket token renewal failed.');
  const session = await response.json();
  socket.auth = { ...socket.auth, token: session.socket_token };
  if (socket.connected) {
    socket.emit('refreshSocketSession', { token: session.socket_token });
  } else {
    socket.connect();
  }
}
```

تنفذ الواجهة `onSessionRenewed` و`onSessionRenewalError` لجدولة التجديد وعرض الأخطاء. جدولوا أول تجديد من `expires_in` المعاد من Laravel، ثم استخدموا `expiresIn` بعد كل تأكيد. يجهّز تحديث `socket.auth` التوكن للاتصال القادم، بينما يجدد حدث `refreshSocketSession` الجلسة القائمة. يبقى `joinRoom` في معالج `connect` للانضمام بعد إعادة اتصال فعلية.

عالجوا أخطاء HTTP وغياب تأكيد Socket بمهلة انتظار محدودة، ثم أعيدوا المحاولة ما دامت الجلسة القديمة فعالة. ألغوا مؤقتات التجديد عند الانقطاع أو تسجيل الخروج وامنعوا الطلبات المتزامنة. تأخر المؤقتات في الخلفية أو فشل الشبكة قد يؤدي إلى انتهاء التوكن. يستخدم هذا التدفق مسار Laravel الحالي وأسرار الخادم الحالية.

## المصدر

`socket/auth/auth.events.js` و`auth.service.js` و`auth.validation.js` و`auth.state.js` و`socket.auth.js`.

# Socket.IO API للواجهة الأمامية

هذه الوثيقة تصف السلوك الموجود حاليًا في الخادم. استخدمها كمرجع للتكامل، واقرأ قسم القيود قبل اعتماد الأحداث المرتبطة بإزالة المستخدم أو الصوت.

## الاتصال

- البروتوكول: Socket.IO (يعتمد على Engine.IO؛ ليس WebSocket خامًا).
- العنوان: `http://<HOST>:<PORT>` أو `https://<HOST>:<PORT>` بحسب إعداد الاستضافة.
- المنفذ الافتراضي: `3000`، ويمكن تغييره عبر `PORT`.
- لا توجد مصادقة أو بيانات handshake مطلوبة حاليًا.
- إعداد CORS الحالي يسمح بجميع origins.

مثال باستخدام JavaScript:

```js
import { io } from "socket.io-client";

const socket = io("https://<HOST>");
```

## طريقة الاستخدام

الأحداث الواردة هي أسماء الأحداث التي ترسلها الواجهة عبر `socket.emit`. الأحداث الصادرة تستقبلها عبر `socket.on`. الخادم لا يستخدم acknowledgements أو callbacks في الأحداث الحالية؛ الردود تصل كأحداث منفصلة.

يجب إرسال `joinRoom` أولًا قبل الرسائل والهدايا وطلب المايك. أغلب الأحداث لا ترسل خطأ عند إرسال حمولة ناقصة أو تنفيذ الطلب خارج غرفة؛ قد يتم تجاهل الطلب أو قد يظهر خطأ بالخادم.

## الأحداث الواردة إلى الخادم

| الحدث | الحمولة | المعنى |
| --- | --- | --- |
| `joinRoom` | `{ roomId: string, user: object }` | انضمام إلى غرفة وتسجيل بيانات المستخدم. يضيف الخادم `socketId` إلى كائن المستخدم. |
| `requestMic` | `{ spotNumber: number }` | طلب مقعد مايك. المقعد المشغول ينتج `micRejected`. |
| `leaveMic` | `{ spotNumber: number }` | طلب تحرير مقعد مايك. |
| `audioData` | أي قيمة قابلة للإرسال عبر Socket.IO | إرسال بيانات صوتية؛ حاليًا يرسل الخادمها لكل الاتصالات الأخرى. |
| `sendMessage` | أي قيمة قابلة للإرسال عبر Socket.IO | نشر رسالة في الغرفة. |
| `sendGift` | أي قيمة قابلة للإرسال عبر Socket.IO | نشر هدية في الغرفة. |
| `removeUser` | `{ roomId: string, targetUserId: string }` | محاولة إزالة مستخدم من الغرفة؛ التنفيذ الحالي فيه خلل موضح أدناه. |

### مثال الانضمام وإرسال رسالة

```js
socket.emit("joinRoom", {
  roomId: "room-123",
  user: {
    userId: "user-42",
    name: "اسم المستخدم",
    avatar: "https://example.com/avatar.png"
  }
});

socket.emit("sendMessage", {
  text: "مرحبًا",
  clientMessageId: "msg-001"
});
```

شكل `user` و`message` و`gift` غير محدد بمخطط ثابت في الخادم؛ يمرر الخادم القيم كما استلمها. على الواجهة الاتفاق على حقول هذه الكائنات مع تطبيق المنتج.

## الأحداث الصادرة من الخادم

| الحدث | المستلم | الحمولة |
| --- | --- | --- |
| `userList` | جميع أعضاء الغرفة | مصفوفة المستخدمين المسجلين. كل مستخدم يحتوي على الأقل ما أرسله العميل، مع إضافة `socketId`. |
| `micUpdate` | جميع أعضاء الغرفة | كائن مفاتيحه أرقام المقاعد وقيمه كائنات المستخدمين، مثل `{ "1": { "userId": "user-42", "name": "اسم المستخدم" } }`. قد تكون القيمة `{}` عند عدم وجود مقاعد مشغولة. |
| `takeMic` | صاحب طلب المايك | `{ spotNumber: number }`. إشارة للواجهة لبدء الإرسال الصوتي. |
| `micRejected` | صاحب الطلب المرفوض | `{ spotNumber: number, reason: string }`. النص الحالي عند انشغال المقعد: `تم أخذ المكان بالفعل`. |
| `leaveMic` | صاحب طلب المغادرة | `{ spotNumber: number }`. يرسلها الخادم كتأكيد طلب، حتى قبل التأكد من ملكية المقعد. |
| `audioData` | كل اتصال آخر بالخادم | `{ userId: socket.id, audio: <الحمولة المرسلة> }`. `userId` هنا هو socket id وليس `user.userId`. |
| `newMessage` | أعضاء الغرفة | `{ message: <الحمولة المرسلة>, user: <المستخدم المسجل على socket> }`. |
| `sendGift` | أعضاء الغرفة | `{ gift: <الحمولة المرسلة>, user: <المستخدم المسجل على socket> }`. |
| `kicked` | المستهدف (بحسب المقصود) | لا توجد حمولة. الحدث غير موثوق حاليًا بسبب الخلل في `removeUser`. |
| `userRemoved` | أعضاء الغرفة (بحسب المقصود) | `{ userId: targetUserId }`. الحدث غير موثوق حاليًا بسبب الخلل في `removeUser`. |

عند الانضمام، يرسل الخادم `userList` للغرفة. يرسل `micUpdate` حين تكون حالة المايكات موجودة. لا يوجد حدث حاليًا مثل `userJoined` أو `userLeft`.

## أمثلة الاستماع

```js
socket.on("userList", (users) => renderUsers(users));
socket.on("micUpdate", (spots) => renderMicSpots(spots));
socket.on("takeMic", ({ spotNumber }) => startPublishingAudio(spotNumber));
socket.on("micRejected", ({ spotNumber, reason }) => showError(reason));
socket.on("newMessage", ({ message, user }) => appendMessage(user, message));
socket.on("sendGift", ({ gift, user }) => showGift(user, gift));
socket.on("audioData", ({ userId, audio }) => playAudio(userId, audio));
socket.on("kicked", () => leaveRoomView());
```

## تفاصيل وقيود مهمة

- `requestMic` يرفض المقعد فقط إذا كان رقمه أكبر من 7 أو كان المقعد مشغولًا. لا يتحقق حاليًا من أن الرقم صحيح موجب، ولا يفرض نطاقًا ثابتًا متسقًا. مقعد 7 مقبول، لكن تنظيف الانقطاع يمر على المقاعد 0 إلى 6 فقط.
- يمكن للمستخدم طلب أكثر من مقعد؛ لا يوجد فحص يمنع ذلك.
- `leaveMic` لا يحرر المقعد إلا إذا تطابق `userId` للمستخدم المخزن، لكن الخادم يرسل `leaveMic` للعميل قبل هذا الفحص.
- بث `audioData` يستخدم `socket.broadcast` على مستوى الخادم، وليس `socket.to(roomId)`؛ لذلك يستلمه مستخدمون خارج الغرفة أيضًا. لا يوجد تحقق من امتلاك المايك.
- `removeUser` غير صالح للاعتماد عليه حاليًا: حالة الأعضاء مخزنة كـ `Set`، لكن الخدمة تستخدمها كأنها `Map` وتستدعي `.get`. كما لا يوجد فحص صلاحية المدير. لا تعتمدوا عليه حتى إصلاحه.
- `sendGift` مجرد بث بيانات إلى الغرفة؛ لا يتحقق الخادم من الرصيد أو الدفع أو صلاحية الهدية.
- لا توجد مصادقة، صلاحيات، مخططات تحقق، أو رسائل أخطاء عامة متفق عليها.
- حالة الغرف والمايكات محفوظة بذاكرة عملية Node.js وتضيع عند إعادة التشغيل، وليست مشتركة بين عدة عمليات.
- انقطاع الاتصال يزيل المستخدم المطابق ويرسل `userList` و`micUpdate`، لكن حذف الغرفة عند فراغها غير مفعل.

## توافق شكل البيانات المقترح للواجهة

الخادم لا يفرض هذه المخططات بعد؛ هي اقتراح تنسيقي للفريق. حافظوا على `userId` ثابت وفريد من جهة التطبيق، ولا تعتمدوا على `socketId` كمعرّف دائم.

```ts
type User = {
  userId: string;
  name?: string;
  avatar?: string;
  // حقول عرض إضافية حسب التطبيق
};

type ChatMessage = {
  id?: string;
  text: string;
  createdAt?: string;
};

type Gift = {
  id: string;
  name?: string;
  // لا يعني هذا أن الخادم تحقق من الدفع أو الرصيد
};
```

## مصدر العقد

راجع التنفيذ في `socket/rooms/room.events.js`, `socket/rooms/room.service.js`, `socket/users/user.events.js`, `socket/users/user.service.js`, `socket/chat/`, و`socket/gifts/`. حدّث هذه الوثيقة عند تغيير أسماء الأحداث أو الحمولات.

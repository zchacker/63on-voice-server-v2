# joinRoom

**الاتجاه:** من العميل إلى الخادم.

## الإدخال

    {
      "roomId": "room-123",
      "user": {
        "userId": "user-42",
        "name": "Sara",
        "avatar": "https://example.com/sara.png"
      }
    }

يجب أن يكون roomId نصًا غير فارغ، وuser كائنًا عاديًا. دون JWT صالح يجب أن يكون user.userId نصًا غير فارغ. مع JWT صالح يستبدل الخادم القيمة بـ sub؛ ويمكن عندها حذف userId من الكائن. يحذف الخادم الحقول role وisModerator وpermissions من user.

## المخرجات عند النجاح

- الغرفة تستقبل userList: عنصر لكل اتصال منضم. يضيف الخادم socketId، ويمرر بقية الحقول التي أرسلها العميل عدا role وisModerator وpermissions التي يحذفها.
- الغرفة تستقبل micUpdate: حالة المقاعد أو {}.
- الاتصال المنضم يستقبل roleUpdated { roomId, userId, role }.
- الاتصال المنضم يستقبل messageLockUpdated { roomId, locked, normalUsersOnly }.
- إذا كان المستخدم مكتومًا يستقبل أيضًا micMuted { roomId, userId }.

لا يوجد acknowledgement لهذا الحدث.

## الرفض

يرسل joinRoomRejected { code, message }:
- INVALID_ROOM_ID: roomId مفقود أو فارغ أو ليس نصًا.
- INVALID_USER: user مفقود أو ليس كائنًا أو كان مصفوفة.
- INVALID_USER_ID: userId مفقود أو غير صالح ولا توجد هوية JWT.
- USER_BANNED: يوجد حظر داخل الذاكرة لمعرف الغرفة والمستخدم الفعلي.

## ملاحظات

JWT يتقدم على userId المرسل من العميل. دونه، يمكن للعميل تزوير الهوية. الخادم لا يستشير Laravel للتحقق من الغرفة أو ملكيتها أو عضويتها أو خصوصيتها. إذا أعاد socket الانضمام، يغادر غرفته السابقة أولًا.

## المصدر

socket/rooms/room.events.js وroom.service.js وroom.validation.js.

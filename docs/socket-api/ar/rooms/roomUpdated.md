# roomUpdated

بعد حفظ تحديث الغرفة بنجاح واعتماد المعاملة في Laravel، يستدعي Laravel نقطة Socket الداخلية. يبث Socket الحدث `roomUpdated` إلى أعضاء الغرفة النشطين فقط.

## طلب Laravel إلى Socket

`POST /internal/socket/v1/rooms/{roomId}/updates`

الترويسات: `Authorization: Bearer <SOCKET_INTERNAL_SERVICE_TOKEN>` و`Content-Type: application/json`.

`roomId` هو معرّف الغرفة الأساسي في Laravel. أرسلوا الحقول العامة التي تغيرت فقط:

```json
{
  "fields": {
    "title": "عنوان الغرفة",
    "image": "https://cdn.example.com/room.png",
    "country": {
      "id": "3",
      "name": "المملكة العربية السعودية",
      "code": "SA",
      "imageUrl": "https://cdn.example.com/sa.png"
    },
    "description": "وصف عام للغرفة"
  }
}
```

`title` نص غير فارغ حتى 100 حرف. يمكن أن تكون `image` و`description` مساويتين لـ`null`، ويصل الوصف إلى 500 حرف. تكون `country` إما `null` أو كائنًا يحتوي بالضبط `id` و`name` و`code` و`imageUrl`؛ ويمكن أن تكون `imageUrl` مساوية لـ`null`. تُرفض الحقول الإضافية لمنع تسريب بيانات داخلية.

بعد البث تعيد النقطة `{ "success": true, "roomId": "10" }`. أخطاء الغرفة أو الحقول تعيد HTTP 422، والاعتماد الداخلي المفقود أو الخاطئ يعيد HTTP 401. يجب استدعاؤها بعد اعتماد حفظ Laravel.

## حدث Socket إلى الواجهة

```json
{
  "roomId": "10",
  "title": "عنوان الغرفة",
  "image": "https://cdn.example.com/room.png"
}
```

يحتوي الحدث الحقول العامة التي تغيرت فقط. يستخدم country البنية الموضحة أعلاه. لا يُرسل الحدث عند فشل حفظ Laravel؛ لذلك يجب ألا يستدعي Laravel نقطة Socket عند فشل الحفظ.

## المصدر

`services/internal-http.service.js` و`socket/rooms/room.validation.js` و`socket/rooms/room.service.js`.

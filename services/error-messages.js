const arabic = require('../locales/ar.json');
const english = require('../locales/en.json');

// Keep stable error codes separate from the text displayed by clients.
function errorMessage(code, fallback, locale = 'ar') {
    const messages = locale === 'en' ? english : arabic;
    return messages[code] || fallback;
}

function roomAccessMessage(code) {
    return errorMessage(code, arabic.ROOM_ACCESS_RESTRICTED);
}

module.exports = { errorMessage, roomAccessMessage };

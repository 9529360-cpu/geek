'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const messenger = require('../src/messenger-webview-send-intent.cjs');

assert.equal(messenger.isMessengerType('messenger'), true);
assert.equal(messenger.isMessengerType('whatsapp'), false);
assert.equal(messenger.isMessengerPageUrl('https://www.facebook.com/messages/'), true);
assert.equal(messenger.isMessengerPageUrl('https://facebook.com/messages/t/123'), true);
assert.equal(messenger.isMessengerPageUrl('https://messenger.com/'), false, 'retired standalone Messenger origin must not enter the account sandbox');
assert.equal(messenger.isMessengerPageUrl('http://www.facebook.com/messages/'), false);
assert.equal(messenger.isMessengerMessagesUrl('https://www.facebook.com/messages/t/123'), true);
assert.equal(messenger.isMessengerMessagesUrl('https://www.facebook.com/profile.php?id=1'), false);
assert.equal(messenger.canonicalConversationId('https://www.facebook.com/messages/t/123/?foo=1'), '/messages/t/123');
assert.equal(messenger.canonicalConversationId('https://www.facebook.com/messages/e2ee/t/456'), '/messages/e2ee/t/456');
assert.equal(messenger.canonicalConversationId('https://www.facebook.com/messages/marketplace/t/789'), '/messages/marketplace/t/789');
assert.equal(messenger.canonicalConversationId('https://www.facebook.com/messages/requests/t/abc'), '/messages/requests/t/abc');
assert.equal(messenger.canonicalConversationId('https://www.facebook.com/messages/'), '');

new vm.Script(messenger.guestConversationExpression());
const focusScript = messenger.focusedComposerScript('/messages/t/123');
assert.match(focusScript, /CHAT_CHANGED/);
assert.match(focusScript, /contenteditable/);
assert.match(focusScript, /role=\\"textbox\\"/);
assert.match(focusScript, /messages/);
new vm.Script(focusScript);

const commitScript = messenger.commitGuardScript('/messages/t/123', 'hello');
assert.match(commitScript, /STALE_CONTEXT/);
assert.match(commitScript, /COMPOSER_MISMATCH/);
assert.match(commitScript, /COMPOSER_NOT_FOCUSED/);
assert.match(commitScript, /data-geek-native-submit-commit/);
assert.match(commitScript, /hello/);
new vm.Script(commitScript);
assert.doesNotMatch(commitScript, /\.click\(|dispatchEvent|sendText/i, 'main-process commit guard must validate/focus only; native Enter remains the effect owner');

console.log('MESSENGER_WEBVIEW_SEND_INTENT_CONTRACT_OK');

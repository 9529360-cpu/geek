'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const instagram = require('../src/instagram-webview-send-intent.cjs');

assert.equal(instagram.isInstagramType('instagram'), true);
assert.equal(instagram.isInstagramType('messenger'), false);
assert.equal(instagram.isInstagramPageUrl('https://www.instagram.com/direct/inbox/'), true);
assert.equal(instagram.isInstagramPageUrl('https://instagram.com/accounts/login/'), true);
assert.equal(instagram.isInstagramPageUrl('https://example.com/direct/inbox/'), false);
assert.equal(instagram.isInstagramPageUrl('http://www.instagram.com/direct/inbox/'), false);
assert.equal(instagram.isInstagramDirectUrl('https://www.instagram.com/direct/t/123/'), true);
assert.equal(instagram.isInstagramDirectUrl('https://www.instagram.com/accounts/login/'), false);
assert.equal(instagram.canonicalConversationId('https://www.instagram.com/direct/t/123/?foo=1'), '/direct/t/123');
assert.equal(instagram.canonicalConversationId('https://www.instagram.com/direct/inbox/'), '');

new vm.Script(instagram.guestConversationExpression());
const focusScript = instagram.focusedComposerScript('/direct/t/123');
assert.match(focusScript, /CHAT_CHANGED/);
assert.match(focusScript, /contenteditable/);
assert.match(focusScript, /role=\\"textbox\\"/);
assert.match(focusScript, /direct/);
new vm.Script(focusScript);

const clearGuard = instagram.clearComposerGuardScript('/direct/t/123');
assert.match(clearGuard, /CHAT_CHANGED/);
assert.match(clearGuard, /COMPOSER_NOT_FOCUSED/);
assert.match(clearGuard, /selectNodeContents/);
assert.match(clearGuard, /contenteditable/);
new vm.Script(clearGuard);
assert.doesNotMatch(clearGuard, /execCommand|\.click\(|dispatchEvent|sendText/i, 'clear guard must select/focus only; native Backspace remains the effect owner');

const emptyScript = instagram.composerEmptyScript('/direct/t/123');
assert.match(emptyScript, /NOT_EMPTY/);
assert.match(emptyScript, /EMPTY/);
assert.match(emptyScript, /CHAT_CHANGED/);
new vm.Script(emptyScript);

const commitScript = instagram.commitGuardScript('/direct/t/123', 'hello');
assert.match(commitScript, /STALE_CONTEXT/);
assert.match(commitScript, /COMPOSER_MISMATCH/);
assert.match(commitScript, /COMPOSER_NOT_FOCUSED/);
assert.match(commitScript, /data-geek-native-submit-commit/);
assert.match(commitScript, /hello/);
new vm.Script(commitScript);
assert.doesNotMatch(commitScript, /\.click\(|dispatchEvent|sendText/i, 'main-process commit guard must validate/focus only; native Enter remains the effect owner');

console.log('INSTAGRAM_WEBVIEW_SEND_INTENT_CONTRACT_OK');

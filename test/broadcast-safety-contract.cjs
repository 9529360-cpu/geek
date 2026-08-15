const assert = require('node:assert/strict');
const safety = require('../ui/broadcast-safety.js');

assert.equal(safety.sameChat('-5387155004', '-5387155004'), true);
assert.equal(safety.sameChat('#-5387155004', '-5387155004'), true);
assert.equal(safety.sameChat('other-chat', '-5387155004'), false);

assert.deepEqual(
  safety.authorizeSend({ opened: false, currentChatId: 'old', targetChatId: 'new', composerResult: 'OK', needsComposer: true }),
  { ok: false, reason: 'OPEN_FAILED' }
);
assert.deepEqual(
  safety.authorizeSend({ opened: true, currentChatId: 'old', targetChatId: 'new', composerResult: 'OK', needsComposer: true }),
  { ok: false, reason: 'WRONG_CHAT' }
);
assert.deepEqual(
  safety.authorizeSend({ opened: true, currentChatId: 'new', targetChatId: 'new', composerResult: 'NO_EDITOR', needsComposer: true }),
  { ok: false, reason: 'COMPOSER_FAILED:NO_EDITOR' }
);
assert.deepEqual(
  safety.authorizeSend({ opened: true, currentChatId: 'new', targetChatId: 'new', composerResult: 'OK', needsComposer: true, expectedComposerText: 'hello', actualComposerText: 'old draft' }),
  { ok: false, reason: 'COMPOSER_MISMATCH' }
);
assert.deepEqual(
  safety.authorizeSend({ opened: true, currentChatId: 'new', targetChatId: 'new', composerResult: 'OK', needsComposer: true, expectedComposerText: 'hello', actualComposerText: 'hello' }),
  { ok: true, reason: '' }
);
assert.deepEqual(
  safety.authorizeSend({ opened: true, currentChatId: 'new', targetChatId: 'new', composerResult: 'OK', needsComposer: true }),
  { ok: true, reason: '' }
);
assert.deepEqual(
  safety.authorizeSend({ opened: true, currentChatId: 'new', targetChatId: 'new', composerResult: 'NO_SET', needsComposer: false }),
  { ok: true, reason: '' }
);
console.log('BROADCAST_SAFETY_CONTRACT_OK');

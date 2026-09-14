'use strict';

const assert = require('node:assert/strict');
const delivery = require('../ui/broadcast-delivery.js');

(async () => {
  assert.deepEqual(
    delivery.normalizeOutcome({ ok: false, reason: 'NOT_SUBMITTED', retryable: true }),
    { ok: false, reason: 'NOT_SUBMITTED', value: { ok: false, reason: 'NOT_SUBMITTED', retryable: true }, retryable: true },
    'only an explicit structured retryable outcome may authorize replay'
  );
  assert.equal(delivery.normalizeOutcome('ERR:TRANSIENT').retryable, false, 'legacy string errors are ambiguous and must not authorize replay');

  const files = [
    { name: 'one.txt' },
    { name: 'two.txt' },
    { name: 'three.txt' },
  ];
  const calls = [];
  let secondAttempts = 0;
  let vcardCalls = 0;
  const recovered = await delivery.sendDirectBundle({
    files,
    message: '正文',
    vcards: [{ id: 'contact-1' }],
    sendFile: async ({ file, caption, attempt }) => {
      calls.push({ name: file.name, caption, attempt });
      if (file.name === 'two.txt' && ++secondAttempts === 1) {
        return { ok: false, reason: 'PRE_SUBMIT_BUSY', retryable: true };
      }
      return 'SENT';
    },
    sendVcards: async cards => {
      vcardCalls += 1;
      assert.equal(cards.length, 1);
      return 'SENT';
    },
  });

  assert.equal(recovered.ok, true);
  assert.deepEqual(calls.map(call => call.name), ['one.txt', 'two.txt', 'two.txt', 'three.txt']);
  assert.equal(calls.filter(call => call.name === 'one.txt').length, 1, 'a confirmed attachment must never be replayed');
  assert.equal(calls.filter(call => call.name === 'three.txt').length, 1, 'later success must not restart the bundle');
  assert.deepEqual(calls.filter(call => call.caption).map(call => call.caption), ['正文'], 'only the last attachment carries the caption');
  assert.equal(vcardCalls, 1, 'vCards are sent once after every attachment succeeds');

  let ambiguousFileCalls = 0;
  const ambiguousFile = await delivery.sendDirectBundle({
    files: [{ name: 'maybe-sent.bin' }],
    message: '',
    vcards: [],
    sendFile: async () => {
      ambiguousFileCalls += 1;
      return 'ERR:TRANSIENT';
    },
  });
  assert.equal(ambiguousFile.ok, false);
  assert.equal(ambiguousFileCalls, 1, 'an ambiguous attachment result must never be replayed automatically');
  assert.match(ambiguousFile.reason, /ERR:TRANSIENT/);

  let timeoutTextCalls = 0;
  const timeoutText = await delivery.sendDirectBundle({
    files: [],
    message: 'may already have been submitted',
    vcards: [],
    sendText: async () => {
      timeoutTextCalls += 1;
      throw new Error('CDP命令超时');
    },
  });
  assert.equal(timeoutText.ok, false);
  assert.equal(timeoutTextCalls, 1, 'a thrown timeout is indeterminate and must stay at-most-once');
  assert.match(timeoutText.reason, /CDP命令超时/);

  let ambiguousTextCalls = 0;
  const ambiguousText = await delivery.sendDirectBundle({
    files: [],
    message: 'plain text',
    vcards: [],
    sendText: async () => {
      ambiguousTextCalls += 1;
      return 'FAIL';
    },
  });
  assert.equal(ambiguousText.ok, false);
  assert.equal(ambiguousTextCalls, 1, 'an unstructured text failure must not be replayed');

  let permanentVcardCalls = 0;
  const permanentFailure = await delivery.sendDirectBundle({
    files: [{ name: 'bad.bin' }],
    message: '不会重复整包',
    vcards: [{ id: 'contact-2' }],
    sendFile: async () => 'ERR:FAILED',
    sendVcards: async () => { permanentVcardCalls += 1; return 'SENT'; },
  });
  assert.equal(permanentFailure.ok, false);
  assert.match(permanentFailure.reason, /bad\.bin/);
  assert.equal(permanentVcardCalls, 0, 'vCards must not be sent after an attachment failure');

  let vcardOnlyCalls = 0;
  const vcardOnly = await delivery.sendDirectBundle({
    message: '',
    files: [],
    vcards: [{ id: 'contact-3' }],
    sendVcards: async () => { vcardOnlyCalls += 1; return 'SENT'; },
  });
  assert.equal(vcardOnly.ok, true);
  assert.equal(vcardOnlyCalls, 1);

  console.log('BROADCAST_DELIVERY_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

'use strict';

const assert = require('node:assert/strict');
const delivery = require('../ui/broadcast-delivery.js');

(async () => {
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
      if (file.name === 'two.txt' && ++secondAttempts === 1) return 'ERR:TRANSIENT';
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

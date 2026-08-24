'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runtimePath = path.join(__dirname, '../ui/broadcast-runtime.js');
const source = fs.readFileSync(runtimePath, 'utf8');
const api = require(runtimePath);

(async () => {
  const executed = [];
  const telegram = {
    platform: { family: 'telegram', sendText: async () => { throw new Error('narrow wrapper must not be used for Telegram'); } },
    wv: { executeJavaScript: async script => { executed.push(script); return 'CLICKED'; } },
  };
  const result = await api.submitVerifiedText(telegram, { send: 'FORMAL_TELEGRAM_SEND_SCRIPT' });
  assert.equal(result, 'CLICKED');
  assert.deepEqual(executed, ['FORMAL_TELEGRAM_SEND_SCRIPT'], 'Telegram text must reuse the mature adapter submit script');

  let genericCalls = 0;
  const generic = {
    platform: { family: 'line', sendText: async value => { genericCalls += 1; assert.equal(value, ''); return 'SENT'; } },
    wv: { executeJavaScript: async () => { throw new Error('non-Telegram must keep the platform wrapper path'); } },
  };
  assert.equal(await api.submitVerifiedText(generic, { send: 'IGNORED' }), 'SENT');
  assert.equal(genericCalls, 1, 'WA/LINE text submit path must remain unchanged');

  assert.match(source, /GeekBroadcastSafety\.authorizeSend\([\s\S]*composerGuard[\s\S]*submitVerifiedText\(ctx, adapter\)/,
    'Telegram mature submit must remain behind target and composer authorization');
  assert.match(source, /ctx\.platform\.family === 'telegram'[\s\S]*sendTelegramAttachments/,
    'Telegram attachment broadcast must keep its separate native attachment path');
  assert.match(source, /typeof adapter\?\.send === 'function' \? adapter\.send\(''\) : adapter\?\.send/,
    'Telegram text must reuse the existing adapter send implementation instead of duplicating selectors');
  assert.doesNotMatch(source, /submitVerifiedText[\s\S]{0,500}sendTelegramAttachments/,
    'text submit helper must not absorb or rewrite the Telegram attachment transport');

  console.log('BROADCAST_TELEGRAM_TEXT_REGRESSION_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

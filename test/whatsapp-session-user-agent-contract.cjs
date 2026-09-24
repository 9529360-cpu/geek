'use strict';

const assert = require('node:assert/strict');
const {
  isWhatsAppAccount,
  applyWhatsAppSessionUserAgent,
} = require('../src/whatsapp-session-user-agent.cjs');

const calls = [];
const fakeSession = {
  setUserAgent(value) { calls.push(value); },
};
const sessionFromPartition = (partition, options) => {
  assert.equal(partition, 'persist:webview-page-wa1');
  assert.deepEqual(options, { cache: true });
  return fakeSession;
};
const account = {
  id: 'wa1',
  type: 'whatsapp',
  partition: 'persist:webview-page-wa1',
};

assert.equal(isWhatsAppAccount(account), true);
assert.equal(isWhatsAppAccount({ ...account, type: 'whatsapp-pure' }), true);
assert.equal(isWhatsAppAccount({ ...account, type: 'telegram-z' }), false);

assert.equal(applyWhatsAppSessionUserAgent({
  account,
  partition: account.partition,
  userAgent: 'Mozilla/5.0 Chrome/124.0.0.0 Safari/537.36',
  sessionFromPartition,
}), true);
assert.deepEqual(calls, ['Mozilla/5.0 Chrome/124.0.0.0 Safari/537.36']);

assert.equal(applyWhatsAppSessionUserAgent({
  account: { ...account, type: 'telegram-z' },
  partition: account.partition,
  userAgent: 'UA',
  sessionFromPartition,
}), false);
assert.equal(applyWhatsAppSessionUserAgent({
  account,
  partition: 'persist:webview-page-other',
  userAgent: 'UA',
  sessionFromPartition,
}), false);
assert.equal(calls.length, 1, 'non-WhatsApp or mismatched partitions must not mutate a Session UA');

assert.throws(() => applyWhatsAppSessionUserAgent({
  account,
  partition: account.partition,
  userAgent: '',
  sessionFromPartition,
}), /userAgent is required/);

console.log('WHATSAPP_SESSION_USER_AGENT_CONTRACT_OK');

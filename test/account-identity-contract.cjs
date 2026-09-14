'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSubscriptionStore } = require('../src/subscription.cjs');

(async () => {
  const subscription = fs.readFileSync(path.join(__dirname, '../src/subscription.cjs'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '../ui/subscription.html'), 'utf8');

  assert.doesNotMatch(subscription, /formatAccountReference|account-reference\.cjs/,
    'desktop subscription state must never derive a support account number from user_id');
  assert.match(subscription, /account_no:\s*identity\.account_no/, 'local state must expose server account_no');
  assert.match(subscription, /account_ref:\s*identity\.account_ref/, 'legacy account_ref must only alias account_no');
  assert.match(subscription, /request\('\/api\/me'\)/, 'old login state must recover account identity from the server');

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'geek-account-no-'));
  await fsp.writeFile(path.join(tempDir, 'subscription.json'), JSON.stringify({
    token: 'enc:legacy-token', email: 'legacy@example.test', user_id: 42,
    account_ref: 'GK-000042', remaining_chars: 100,
  }), 'utf8');

  const store = createSubscriptionStore({ userDataDir: tempDir });
  store._injectCrypto({ encrypt: (value) => value, decrypt: (value) => value });
  const before = await store.getState();
  assert.equal(before.user_id, 42);
  assert.equal(before.account_no, '', 'legacy state must not synthesize a replacement account_no');
  assert.equal(before.account_ref, '', 'legacy GK-000xxx cache must not remain visible');

  const calls = [];
  const realFetch = global.fetch;
  const serverAccountNo = 'GK-58b81cb8727a9fbc947b2f4fb89231ad';
  global.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/api/status')) return new Response(JSON.stringify({ ok: true, remaining_chars: 321 }), { status: 200 });
    if (String(url).endsWith('/api/me')) return new Response(JSON.stringify({ ok: true, user: { id: 42, email: 'legacy@example.test', account_no: serverAccountNo } }), { status: 200 });
    throw new Error('unexpected request ' + url);
  };
  try {
    const refreshed = await store.refresh();
    assert.equal(refreshed.account_no, serverAccountNo);
    assert.equal(refreshed.account_ref, serverAccountNo, 'account_ref may exist only as a server account_no alias');
    assert.ok(calls.some((url) => url.endsWith('/api/me')), 'old state must request /api/me');
    const disk = JSON.parse(await fsp.readFile(path.join(tempDir, 'subscription.json'), 'utf8'));
    assert.equal(disk.account_no, serverAccountNo, 'server account_no must persist across restart');
    assert.equal(disk.account_ref, serverAccountNo);
    assert.equal(disk.user_id, 42, 'internal user_id remains available for compatibility');
  } finally {
    global.fetch = realFetch;
    await fsp.rm(tempDir, { recursive: true, force: true });
  }

  assert.match(ui, /let currentPlan = 'basic'/, 'default selected plan and submitted plan must remain aligned');
  assert.match(ui, /pass\.length < 10 \|\| pass\.length > 128/, 'desktop password rule must remain 10–128 characters');
  assert.match(ui, /id="home-account-ref"/, 'personal center must keep a visible support account number field');
  assert.match(ui, /账号号暂不可用/, 'desktop must show an unavailable state instead of fabricating a value');
  assert.doesNotMatch(ui, /密码（至少 6 位）/, 'obsolete 6-character password copy must not return');

  assert.doesNotMatch(ui, /付款后由客服手动开通/, 'do not describe balance updates as manual activation');
  assert.doesNotMatch(ui, /客服确认收款后自动到账/, 'do not conflate receipt confirmation with automatic character crediting');
  assert.match(ui, /收款确认后字符余额自动更新/, 'plan copy must preserve automatic balance wording');
  assert.match(ui, /客服确认收款后，系统自动增加字符余额/, 'manual order copy must distinguish confirmation from automatic crediting');
  assert.match(ui, /订单已确认到账！剩余/, 'success state must describe the exact paid order and updated balance');
  assert.match(ui, /订单尚未确认到账，请稍后再试；如长时间未更新，请联系客服/, 'pending state must remain accurate');
  assert.match(subscription, /request\('\/api\/orders', \{ method: 'POST', body: \{ plan \} \}\)/,
    'account-number work must not alter the desktop manual-order request contract');
  assert.doesNotMatch(ui, /pay_method\s*:\s*['"]usdt['"]/, 'desktop USDT payment must not be enabled by this change');

  console.log('ACCOUNT_IDENTITY_CONTRACT_OK');
})().catch((error) => { console.error(error); process.exitCode = 1; });

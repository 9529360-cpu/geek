import test from 'node:test';
import assert from 'node:assert/strict';
import { deferred, fixture, signedIn, signedOut, turn } from './helpers/translation.mjs';

test('original login surface opens from personal center and consumes only authoritative balance', async () => {
  const ui = await fixture({ sessionState: signedOut() });
  await ui.click('settings-session-open');
  assert.equal(ui.panel, 'session-overlay');
  assert.equal(ui.get('session-view-login').classList.contains('on'), true);
  assert.equal(ui.get('settings-account-quota').textContent, '字符余额未知');
  assert.equal(ui.get('session-go-register').disabled, true);
  assert.equal(ui.get('session-btn-open-plans').disabled, true);
  ui.get('session-in-email').value = ' synthetic@example.invalid ';
  ui.get('session-in-pass').value = 'synthetic-password';
  await ui.click('session-btn-login');
  assert.equal(ui.calls.filter(([name]) => name === 'sessionLogin').length, 1);
  assert.equal(ui.calls.find(([name]) => name === 'sessionLogin')[1].email, 'synthetic@example.invalid');
  assert.equal(ui.get('session-in-pass').value, '');
  assert.equal(ui.get('session-view-home').classList.contains('on'), true);
  assert.match(ui.get('session-home-quota').textContent, /20,000/);
  assert.equal(ui.get('settings-account-email').textContent, 'synthetic@example.invalid');
  await ui.click('session-btn-enter');
  assert.equal(ui.panel, null);
});

test('login clears the password before awaiting, coalesces clicks and preserves a safe failure', async () => {
  const pending = deferred();
  const ui = await fixture({ sessionState: signedOut(), before: (name) => name === 'sessionLogin' ? pending.promise : undefined });
  await ui.click('settings-session-open');
  ui.get('session-in-email').value = 'synthetic@example.invalid';
  ui.get('session-in-pass').value = 'synthetic-password';
  ui.get('session-btn-login').fire('click');
  assert.equal(ui.get('session-in-pass').value, '');
  assert.equal(ui.get('session-btn-login').disabled, true);
  assert.equal(ui.get('session-btn-close').disabled, false);
  ui.get('session-btn-login').fire('click');
  pending.reject('SESSION_INVALID_CREDENTIALS');
  await ui.idle();
  assert.equal(ui.calls.filter(([name]) => name === 'sessionLogin').length, 1);
  assert.match(ui.get('session-login-err').textContent, /邮箱或密码不正确/);
  assert.equal(ui.session.snapshot.state, 'signedOut');
  assert.equal(ui.get('session-in-pass').value, '');
});

test('a late initial session read cannot undo a newer successful login', async () => {
  const pending = deferred();
  const ui = await fixture({ sessionState: signedOut(), wait: false,
    before: (name) => name === 'sessionSnapshot' ? pending.promise : undefined });
  ui.get('session-in-email').value = 'synthetic@example.invalid';
  ui.get('session-in-pass').value = 'synthetic-password';
  ui.get('session-btn-login').fire('click');
  await turn();
  assert.equal(ui.session.snapshot.state, 'signedIn');
  pending.resolve({ ...signedOut(), revision: 99 });
  await ui.idle();
  assert.equal(ui.session.snapshot.state, 'signedIn');
  assert.match(ui.get('settings-account-quota').textContent, /20,000/);
});

test('failed logout keeps the existing identity; successful logout clears it', async () => {
  const ui = await fixture();
  await ui.click('settings-session-open');
  ui.failures.set('sessionLogout', 'SESSION_PERSISTENCE');
  await ui.click('session-home-logout');
  assert.equal(ui.session.snapshot.state, 'signedIn');
  assert.match(ui.get('session-home-logout-err').textContent, /退出未完成/);
  assert.equal(ui.get('settings-account-email').textContent, 'synthetic@example.invalid');
  ui.failures.delete('sessionLogout');
  await ui.click('session-home-logout');
  assert.equal(ui.session.snapshot.state, 'signedOut');
  assert.equal(ui.get('settings-account-email').textContent, '未登录');
  assert.equal(ui.get('settings-account-quota').textContent, '字符余额未知');
});

test('stale or unavailable quota is unknown rather than zero or a successful authorization', async () => {
  const ui = await fixture({ sessionState: signedIn({ remainingChars: 0, quotaFresh: false, issue: 'NETWORK_UNAVAILABLE' }) });
  assert.equal(ui.get('settings-account-quota').textContent, '字符余额未知');
  assert.equal(ui.get('translation-service-state').textContent, '余额待确认');
  ui.publishSession(signedIn({ revision: 3, remainingChars: 0, quotaFresh: true }));
  await ui.session.refresh();
  assert.equal(ui.get('translation-service-state').textContent, '字符已用完');
  ui.failures.set('sessionRefresh', 'secret=private-native-error');
  await ui.session.refresh();
  assert.equal(ui.get('settings-account-quota').textContent, '字符余额未知');
  assert.doesNotMatch(ui.get('settings-session-status').textContent, /secret|private-native/);
});

test('closing the dialog during login does not reopen it when the request completes', async () => {
  const pending = deferred();
  const ui = await fixture({ sessionState: signedOut(), before: (name) => name === 'sessionLogin' ? pending.promise : undefined });
  await ui.click('settings-session-open');
  ui.get('session-in-email').value = 'synthetic@example.invalid'; ui.get('session-in-pass').value = 'synthetic-password';
  ui.get('session-btn-login').fire('click'); ui.get('session-btn-close').fire('click');
  await turn();
  assert.equal(ui.panel, null);
  pending.resolve(signedIn()); await ui.idle();
  assert.equal(ui.panel, null); assert.equal(ui.session.snapshot.state, 'signedIn');
  assert.equal(ui.get('session-in-pass').value, '');
});

test('signed-in persistence failure preserves identity without claiming authorization or completed logout', async () => {
  const ui = await fixture({ sessionState: signedIn({ issue: 'PERSISTENCE_FAILED' }) });
  assert.equal(ui.get('settings-account-email').textContent, 'synthetic@example.invalid');
  assert.equal(ui.get('translation-service-state').textContent, '余额待确认');
  assert.equal(ui.get('session-home-icon').textContent, '⚠️');
  assert.match(ui.get('settings-session-status').textContent, /保存失败/);
  assert.doesNotMatch(ui.get('settings-session-status').textContent, /已退出|授权有效|可以翻译/);
});

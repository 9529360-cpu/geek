import test from 'node:test';
import assert from 'node:assert/strict';
import { deferred, fixture, signedIn, signedOut, turn } from './helpers/translation.mjs';

const calls = (ui, name) => ui.calls.filter(([kind]) => kind === name).length;
const cleanup = (t, ui) => t.after(() => { ui.session.dispose(); ui.translation.dispose(); });
const advance = async (ui, milliseconds = 1500) => { ui.sessionTimers.advance(milliseconds); await ui.idle(); };

test('visible translation settings read current native quota, unknown balance and revocation without a network refresh', async (t) => {
  const ui = await fixture(); cleanup(t, ui);
  ui.publishSession(signedIn({ revision: 3, remainingChars: 80 }));
  await ui.click('btn-translation');
  assert.equal(ui.session.snapshot.remainingChars, 80);
  assert.match(ui.get('translation-service-detail').textContent, /80/);
  assert.equal(calls(ui, 'sessionSnapshot'), 2);
  await advance(ui, 1499); assert.equal(calls(ui, 'sessionSnapshot'), 2);

  ui.publishSession(signedIn({ revision: 4, remainingChars: null, quotaFresh: false }));
  await advance(ui, 1);
  assert.equal(ui.get('translation-service-state').textContent, '余额待确认');
  assert.equal(ui.get('settings-account-quota').textContent, '字符余额未知');
  ui.publishSession({ ...signedOut(), revision: 5, issue: 'UNAUTHORIZED' });
  await advance(ui);
  assert.equal(ui.session.snapshot.state, 'signedOut');
  assert.equal(ui.get('translation-session-open').hidden, false);
  assert.equal(ui.get('translation-service-state').textContent, '需要登录');
  assert.equal(calls(ui, 'sessionRefresh'), 0);
});

test('read-only snapshots stay single flight across close and reopen and reject the old presentation response', async (t) => {
  const held = deferred(); let reads = 0;
  const ui = await fixture({ before(name) {
    if (name === 'sessionSnapshot' && ++reads === 2) return held.promise;
  } }); cleanup(t, ui);
  ui.get('btn-translation').fire('click'); await turn();
  assert.equal(reads, 2); assert.equal(ui.sessionTimers.pending, 0);
  ui.sessionTimers.advance(20_000); await turn(); assert.equal(reads, 2);
  await ui.hidePanel();
  await ui.showPanel('translation-popover');
  assert.equal(reads, 2);
  ui.publishSession(signedIn({ revision: 4, remainingChars: 40 }));
  held.resolve(signedIn({ revision: 90, remainingChars: 9999 }));
  await ui.idle();
  assert.equal(reads, 3); assert.equal(ui.session.snapshot.revision, 4);
  assert.equal(ui.session.snapshot.remainingChars, 40);
  assert.equal(ui.sessionTimers.pending, 1);
});

test('a snapshot captured before logout cannot revive signed-in state even with a greater revision', async (t) => {
  const held = deferred(); let reads = 0;
  const ui = await fixture({ before(name) {
    if (name === 'sessionSnapshot' && ++reads === 2) return held.promise;
  } }); cleanup(t, ui);
  await ui.showPanel('session-overlay'); await turn();
  ui.get('session-home-logout').fire('click'); await turn();
  assert.equal(calls(ui, 'sessionLogout'), 1);
  assert.equal(ui.session.snapshot.state, 'signedOut');
  const loggedOut = structuredClone(ui.session.snapshot);
  held.resolve(signedIn({ revision: 999, remainingChars: 1_000_000 }));
  await ui.idle();
  assert.deepEqual(ui.session.snapshot, loggedOut);
  assert.equal(ui.get('session-view-login').classList.contains('on'), true);
  await advance(ui);
  assert.equal(ui.session.snapshot.state, 'signedOut');
});

test('a background read cannot invalidate or publish over a pending login', async (t) => {
  const heldRead = deferred(), heldLogin = deferred(); let reads = 0;
  const ui = await fixture({ sessionState: signedOut(), before(name) {
    if (name === 'sessionSnapshot' && ++reads === 2) return heldRead.promise;
    if (name === 'sessionLogin') return heldLogin.promise;
  } }); cleanup(t, ui);
  await ui.showPanel('session-overlay'); await turn();
  ui.get('session-in-email').value = 'new@example.invalid'; ui.get('session-in-pass').value = 'synthetic';
  ui.get('session-btn-login').fire('click'); await turn();
  heldRead.resolve(signedIn({ revision: 100, remainingChars: 999 })); await turn();
  ui.sessionTimers.advance(20_000); await turn();
  assert.equal(reads, 2); assert.equal(ui.session.snapshot.state, 'signedOut');
  assert.equal(ui.get('session-btn-login').textContent, '登录中…');
  const next = signedIn({ revision: 3, remainingChars: 60,
    user: { id: 8, email: 'new@example.invalid', accountNo: 'TEST-8' } });
  heldLogin.resolve(next); await ui.idle();
  assert.deepEqual(ui.session.snapshot, next);
  assert.equal(ui.get('session-home-email').textContent, 'new@example.invalid');
  assert.equal(ui.sessionTimers.pending, 1);
});

test('explicit refresh keeps its epoch while an older snapshot fails and quiet polling stays paused', async (t) => {
  const heldRead = deferred(), heldRefresh = deferred(); let reads = 0;
  const ui = await fixture({ before(name) {
    if (name === 'sessionSnapshot' && ++reads === 2) return heldRead.promise;
    if (name === 'sessionRefresh') return heldRefresh.promise;
  } }); cleanup(t, ui);
  ui.get('btn-translation').fire('click'); await turn();
  const refresh = ui.session.refresh(); await turn();
  heldRead.reject('STORE_IO'); await turn();
  ui.sessionTimers.advance(20_000); await turn();
  assert.equal(reads, 2); assert.equal(ui.session.error, '');
  const next = signedIn({ revision: 4, remainingChars: 180 });
  heldRefresh.resolve(next); assert.equal(await refresh, true); await ui.idle();
  assert.deepEqual(ui.session.snapshot, next);
  assert.equal(ui.session.error, ''); assert.equal(ui.sessionTimers.pending, 1);
});

test('a failed snapshot shows unconfirmed balance and a later valid read clears only that read failure', async (t) => {
  const ui = await fixture(); cleanup(t, ui); await ui.click('btn-translation');
  const nativeRead = ui.api.sessionSnapshot;
  ui.api.sessionSnapshot = () => { throw 'STORE_IO'; };
  await advance(ui);
  assert.equal(ui.session.snapshot.remainingChars, 20000);
  assert.equal(ui.get('translation-service-state').textContent, '余额待确认');
  assert.equal(ui.get('settings-account-quota').textContent, '字符余额未知');
  ui.api.sessionSnapshot = nativeRead;
  ui.publishSession(signedIn({ revision: 3, remainingChars: 25 })); await advance(ui);
  assert.equal(ui.session.error, ''); assert.match(ui.get('translation-service-detail').textContent, /25/);
  assert.equal(calls(ui, 'sessionRefresh'), 0);
});

test('quiet success, failed reads and older revisions cannot erase an explicit durable logout failure', async (t) => {
  const ui = await fixture(); cleanup(t, ui); await ui.showPanel('session-overlay'); await ui.idle();
  ui.failures.set('sessionLogout', 'SESSION_PERSISTENCE'); await ui.click('session-home-logout');
  const message = ui.get('session-home-logout-err').textContent;
  assert.match(message, /退出未完成/);
  ui.publishSession(signedIn({ revision: 4, remainingChars: 10 })); await advance(ui);
  assert.equal(ui.get('session-home-logout-err').textContent, message);
  assert.equal(ui.session.snapshot.remainingChars, 10);
  ui.failures.set('sessionSnapshot', 'NETWORK_UNAVAILABLE'); await advance(ui);
  assert.equal(ui.get('session-home-logout-err').textContent, message);
  ui.failures.delete('sessionSnapshot');
  ui.publishSession(signedIn({ revision: 3, remainingChars: 900 })); await advance(ui);
  assert.equal(ui.session.snapshot.remainingChars, 10);
  assert.equal(ui.get('session-home-logout-err').textContent, message);
  assert.equal(calls(ui, 'sessionLogout'), 1);
});

test('hidden documents and closed panels stop polling, and returning to a visible panel synchronizes immediately', async (t) => {
  const ui = await fixture(); cleanup(t, ui); await ui.click('btn-translation');
  const before = calls(ui, 'sessionSnapshot');
  ui.document.visibilityState = 'hidden'; ui.document.fire('visibilitychange');
  assert.equal(ui.sessionTimers.pending, 0); await advance(ui, 20_000);
  assert.equal(calls(ui, 'sessionSnapshot'), before);
  ui.publishSession(signedIn({ revision: 3, remainingChars: 30 }));
  ui.document.visibilityState = 'visible'; ui.document.fire('visibilitychange'); await ui.idle();
  assert.equal(calls(ui, 'sessionSnapshot'), before + 1); assert.equal(ui.session.snapshot.remainingChars, 30);
  await ui.hidePanel(); assert.equal(ui.sessionTimers.pending, 0); await advance(ui, 20_000);
  assert.equal(calls(ui, 'sessionSnapshot'), before + 1);
  await ui.showPanel('session-overlay'); await ui.idle();
  assert.equal(calls(ui, 'sessionSnapshot'), before + 2); assert.equal(calls(ui, 'sessionRefresh'), 0);
});

test('closing during a native read discards its result and disposal removes future reads and listeners', async (t) => {
  const held = deferred(); let reads = 0;
  const ui = await fixture({ before(name) {
    if (name === 'sessionSnapshot' && ++reads === 2) return held.promise;
  } }); cleanup(t, ui);
  ui.get('btn-translation').fire('click'); await turn();
  await ui.hidePanel(); const before = structuredClone(ui.session.snapshot);
  held.resolve(signedIn({ revision: 6, remainingChars: 1 })); await ui.idle();
  assert.deepEqual(ui.session.snapshot, before); assert.equal(ui.sessionTimers.pending, 0);
  ui.session.dispose();
  await ui.showPanel('translation-popover');
  ui.document.fire('visibilitychange'); await advance(ui, 20_000);
  assert.equal(reads, 2); assert.equal(ui.sessionTimers.pending, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { healthOf } from '../frontend/models/translation-health.mjs';
import { connectDesktop } from '../frontend/api/desktop.mjs';
import { deferred, fixture, gatewayHealth, signedOut, turn } from './helpers/translation.mjs';

test('gateway check uses a credential-free command and reports actual connection observations', async (t) => {
  const invoked = [];
  const api = connectDesktop(async (...args) => { invoked.push(args); return gatewayHealth(); });
  await api.translationHealth();
  assert.deepEqual(invoked, [['translation_health']]);
  const ui = await fixture({ sessionState: signedOut() });
  t.after(() => { ui.translation.dispose(); ui.session.dispose(); });
  await ui.click('btn-translation'); await ui.click('translation-gateway-test');
  assert.match(ui.get('translation-gateway-status').textContent, /主网关可达.*42 ms/);
  assert.match(ui.get('translation-gateway-status').textContent, /备用网关未配置/);
  assert.match(ui.get('translation-gateway-status').textContent, /未测量实际翻译耗时/);
  assert.equal(ui.get('translation-gateway-status').dataset.state, 'ok');
  assert.equal(ui.get('translation-service-state').textContent, '需要登录');
  assert.equal(ui.calls.filter(([name]) => name === 'health').length, 1);
  assert.equal(ui.calls.some(([name]) => ['update', 'translate', 'send'].includes(name)), false);
});

test('health and account readiness fail independently and explicit retry replaces the observation', async (t) => {
  const ui = await fixture();
  t.after(() => { ui.translation.dispose(); ui.session.dispose(); });
  await ui.click('btn-translation');
  ui.failures.set('sessionRefresh', 'NETWORK_UNAVAILABLE');
  await ui.click('translation-gateway-test');
  assert.equal(ui.get('translation-gateway-status').dataset.state, 'ok');
  ui.failures.delete('sessionRefresh'); ui.failures.set('health', 'https://private.invalid/?token=secret');
  await ui.click('translation-gateway-test');
  assert.equal(ui.get('translation-gateway-status').dataset.state, 'error');
  assert.doesNotMatch(ui.get('translation-gateway-status').textContent, /private|secret|https/);
  assert.equal(ui.get('translation-service-state').textContent, '账户已登录');
  ui.failures.delete('health'); await ui.click('translation-gateway-test');
  assert.equal(ui.get('translation-gateway-status').dataset.state, 'ok');
});

test('duplicate health clicks coalesce and a disposed surface ignores late completion', async (t) => {
  const held = deferred();
  const ui = await fixture({ before: (name) => name === 'health' ? held.promise : undefined });
  t.after(() => { ui.translation.dispose(); ui.session.dispose(); });
  await ui.click('btn-translation');
  ui.get('translation-gateway-test').fire('click');
  ui.get('translation-gateway-test').fire('click');
  await turn();
  assert.equal(ui.calls.filter(([name]) => name === 'health').length, 1);
  assert.equal(ui.get('translation-gateway-test').disabled, true);
  const before = ui.get('translation-gateway-status').textContent;
  ui.translation.dispose(); held.resolve(gatewayHealth()); await ui.idle();
  assert.equal(ui.get('translation-gateway-status').textContent, before);
});

test('malformed health counters, fake routes and private diagnostics cannot become success', async (t) => {
  const mutations = [
    (v) => { v.availableCount = 2; },
    (v) => { v.routes.backup.healthy = true; },
    (v) => { v.recommendedRoute = 'backup'; },
    (v) => { v.routes.primary.latencyMs = -1; },
    (v) => { v.routes.primary.url = 'https://private.invalid'; },
    (v) => { v.routes.primary.code = '<script>secret</script>'; },
  ];
  for (const mutate of mutations) {
    const value = gatewayHealth(); mutate(value);
    assert.throws(() => healthOf(value), (error) => error === 'NETWORK_RESPONSE_INVALID');
  }
  const ui = await fixture({ before: (name) => name === 'health' ? { ok: true, privateToken: 'secret' } : undefined });
  t.after(() => { ui.translation.dispose(); ui.session.dispose(); });
  await ui.click('btn-translation'); await ui.click('translation-gateway-test');
  assert.equal(ui.get('translation-gateway-status').dataset.state, 'error');
  assert.doesNotMatch(ui.get('translation-gateway-status').textContent, /secret/);
});

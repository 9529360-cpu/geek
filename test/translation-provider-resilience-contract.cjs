'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const workerSource = fs.readFileSync(path.join(root, 'scripts', 'geek-translate-worker.js'), 'utf8');

function response(status, payload, headers = {}) {
  return new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function loadWorker(fetchImpl) {
  const executable = workerSource.replace(/^export default\s*/m, 'this.__worker = ')
    + '\nthis.__resilience = { translate, providerState, parseRetryAfterMs, shouldRetryProviderError };';
  const sandbox = {
    Response,
    Request,
    Headers,
    URL,
    TextEncoder,
    TextDecoder,
    AbortController,
    crypto: globalThis.crypto,
    btoa,
    atob,
    console,
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(executable, sandbox, { filename: 'scripts/geek-translate-worker.js' });
  return sandbox.__resilience;
}

(async () => {
  {
    let calls = 0;
    const hooks = loadWorker(async () => {
      calls += 1;
      if (calls === 1) return response(503, { error: 'temporary upstream failure' });
      return response(200, { choices: [{ message: { content: 'Ciao' } }] });
    });
    const result = await hooks.translate('Hello', 'auto', 'it', { GEMINI_API_KEY: 'gemini-key' }, Date.now() + 30_000);
    assert.equal(result.engine, 'gemini');
    assert.equal(result.text, 'Ciao');
    assert.equal(calls, 2, 'one fast transient upstream failure must receive one bounded same-provider retry');
    assert.equal(hooks.providerState.get('gemini').failCount, 0, 'successful retry must restore provider health');
  }

  {
    let calls = 0;
    const hooks = loadWorker(async () => {
      calls += 1;
      return response(503, { error: 'still unavailable' });
    });
    await assert.rejects(
      hooks.translate('Hello', 'auto', 'it', { GEMINI_API_KEY: 'gemini-key' }, Date.now() + 30_000),
      /503/
    );
    assert.equal(calls, 2, 'a transient provider error gets at most one retry');
    const state = hooks.providerState.get('gemini');
    assert.equal(state.failCount, 1, 'two attempts inside one request must count as one shared breaker failure');
    assert.equal(state.healthy, true, 'one failed user request must not open the shared provider circuit');
  }

  {
    let calls = 0;
    const hooks = loadWorker(async () => {
      calls += 1;
      return response(429, { error: 'rate limited' }, { 'Retry-After': '45' });
    });
    await assert.rejects(
      hooks.translate('Hello', 'auto', 'it', { MISTRAL_API_KEY: 'mistral-key' }, Date.now() + 30_000),
      /429/
    );
    const state = hooks.providerState.get('mistral');
    assert.equal(state.failCount, 0, '429 is availability backoff, not shared provider health failure');
    assert.equal(state.healthy, true, '429 must not open the provider health circuit');
    assert.ok(state.rateLimitedUntil > Date.now() + 40_000, 'Retry-After must quarantine the provider for the advertised window');
    await assert.rejects(
      hooks.translate('Hello', 'auto', 'it', { MISTRAL_API_KEY: 'mistral-key' }, Date.now() + 30_000),
      /暂不可用|failed|rate/i
    );
    assert.equal(calls, 1, 'rate-limited provider must not be hammered again during quarantine');
    assert.equal(hooks.parseRetryAfterMs('2', 1_000), 2_000);
  }

  {
    let body = null;
    const hooks = loadWorker(async (_url, init) => {
      body = JSON.parse(init.body);
      return response(200, { choices: [{ message: { content: 'Ciao' } }] });
    });
    const result = await hooks.translate('Hello', 'auto', 'it', { ZAI_API_KEY: 'glm-key' }, Date.now() + 30_000);
    assert.equal(result.engine, 'glm');
    assert.deepEqual(JSON.parse(JSON.stringify(body.thinking)), { type: 'disabled' },
      'GLM translation calls must disable reasoning so translated text arrives in message.content');
  }

  assert.match(workerSource, /callProviderWithRetry\(/, 'Worker must own the bounded transient retry policy');
  assert.match(workerSource, /provider_rate_limited/, 'Worker must keep provider 429 separate from breaker health');
  assert.match(workerSource, /thinking:\s*\{\s*type:\s*'disabled'/, 'GLM translation fallback must disable thinking');
  assert.doesNotMatch(workerSource, /reasoning_content\)\s*result\s*=/,
    'translation must never promote provider chain-of-thought into user-visible translated text');

  console.log('TRANSLATION_PROVIDER_RESILIENCE_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

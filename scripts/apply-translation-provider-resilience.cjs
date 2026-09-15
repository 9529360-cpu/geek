'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workerPath = path.join(root, 'scripts', 'geek-translate-worker.js');
const testPath = path.join(root, 'test', 'translation-provider-resilience-contract.cjs');
const workflowPath = path.join(root, '.github', 'workflows', 'apply-translation-provider-resilience.yml');
const selfPath = __filename;
let worker = fs.readFileSync(workerPath, 'utf8').replace(/\r\n?/g, '\n');

function replaceOnce(label, before, after) {
  const first = worker.indexOf(before);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (worker.indexOf(before, first + before.length) >= 0) throw new Error(`Ambiguous patch anchor: ${label}`);
  worker = worker.slice(0, first) + after + worker.slice(first + before.length);
}

replaceOnce(
  'GLM disables thinking for translation',
  "  { id: 'glm',    model: 'glm-4.7-flash',          base: 'https://api.z.ai/api/paas/v4',           keyEnv: 'ZAI_API_KEY' },",
  "  { id: 'glm',    model: 'glm-4.7-flash',          base: 'https://api.z.ai/api/paas/v4',           keyEnv: 'ZAI_API_KEY', body: { thinking: { type: 'disabled' } } },"
);

replaceOnce(
  'resilience constants',
  'const FINISH_RESERVE_MS = 500;',
  `const FINISH_RESERVE_MS = 500;\nconst TRANSIENT_RETRY_MAX_MS = 5000;\nconst TRANSIENT_RETRY_DELAY_MS = 150;\nconst RATE_LIMIT_FALLBACK_MS = 30000;\nconst RATE_LIMIT_MAX_MS = 300000;`
);

replaceOnce(
  'provider fault helpers',
  `function markProviderFail(id, errorMessage) {`,
  `function parseRetryAfterMs(value, now = Date.now()) {\n  const raw = String(value || '').trim();\n  if (!raw) return 0;\n  const seconds = Number(raw);\n  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(RATE_LIMIT_MAX_MS, Math.ceil(seconds * 1000));\n  const absolute = Date.parse(raw);\n  if (!Number.isFinite(absolute)) return 0;\n  return Math.min(RATE_LIMIT_MAX_MS, Math.max(0, absolute - now));\n}\n\nfunction providerHttpError(provider, response, rawBody) {\n  const error = new Error(\`${'${provider.id}'}: ${'${response.status}'} ${'${String(rawBody || \'\').slice(0, 100)}'}\`);\n  error.status = response.status;\n  if (response.status === 429) {\n    error.code = 'provider_rate_limited';\n    error.healthImpact = false;\n    error.retryAfterMs = parseRetryAfterMs(response.headers.get('Retry-After')) || RATE_LIMIT_FALLBACK_MS;\n    return error;\n  }\n  if (response.status === 408 || response.status >= 500) {\n    error.code = 'provider_transient_http';\n    error.retryable = true;\n    return error;\n  }\n  error.code = 'provider_http_error';\n  return error;\n}\n\nfunction providerTransportError(provider, cause) {\n  const error = new Error(\`${'${provider.id}'}: transport failure\`);\n  error.code = 'provider_transport';\n  error.retryable = true;\n  error.cause = cause;\n  return error;\n}\n\nfunction providerMalformedResponseError(provider, cause) {\n  const error = new Error(\`${'${provider.id}'}: malformed response\`);\n  error.code = 'provider_malformed_response';\n  error.retryable = true;\n  error.cause = cause;\n  return error;\n}\n\nfunction providerEmptyResponseError(provider, stage = 'response') {\n  const error = new Error(\`${'${provider.id}'}: empty ${'${stage}'}\`);\n  error.code = 'provider_empty_response';\n  error.retryable = true;\n  return error;\n}\n\nfunction shouldRetryProviderError(error) {\n  return error?.retryable === true;\n}\n\nfunction sleep(ms) {\n  return new Promise(resolve => setTimeout(resolve, ms));\n}\n\nfunction markProviderFail(id, errorMessage) {`
);

replaceOnce(
  'provider success clears rate limit quarantine',
  `  st.healthy = true; st.failCount = 0; st.lastError = ''; st.lastOkAt = Date.now();\n  providerState.set(id, st);\n}\n\nfunction providerUsable(provider) {\n  const st = providerState.get(provider.id);\n  if (!st || st.healthy) return true;\n  return Date.now() - (st.lastFailAt || 0) > COOLDOWN_MS;\n}`,
  `  st.healthy = true; st.failCount = 0; st.lastError = ''; st.lastOkAt = Date.now(); st.rateLimitedUntil = 0;\n  providerState.set(id, st);\n}\n\nfunction markProviderRateLimited(id, error) {\n  const st = providerState.get(id) || { healthy: true, failCount: 0, lastError: '', lastFailAt: 0, lastOkAt: 0, rateLimitedUntil: 0 };\n  const retryMs = Math.max(1000, Math.min(RATE_LIMIT_MAX_MS, Number(error?.retryAfterMs) || RATE_LIMIT_FALLBACK_MS));\n  st.rateLimitedUntil = Date.now() + retryMs;\n  st.lastError = String(error?.message || 'provider rate limited');\n  providerState.set(id, st);\n}\n\nfunction providerUsable(provider) {\n  const st = providerState.get(provider.id);\n  const now = Date.now();\n  if (st?.rateLimitedUntil && st.rateLimitedUntil > now) return false;\n  if (!st || st.healthy) return true;\n  return now - (st.lastFailAt || 0) > COOLDOWN_MS;\n}`
);

replaceOnce(
  'health exposes safe rate limit window',
  `    const st = providerState.get(p.id) || { healthy: true, lastError: '', failCount: 0, lastFailAt: 0, lastOkAt: 0 };\n    status[p.id] = { healthy: st.healthy, failCount: st.failCount, lastError: st.lastError.slice(0, 120), lastFailAt: st.lastFailAt ? new Date(st.lastFailAt).toISOString() : null, lastOkAt: st.lastOkAt ? new Date(st.lastOkAt).toISOString() : null };`,
  `    const st = providerState.get(p.id) || { healthy: true, lastError: '', failCount: 0, lastFailAt: 0, lastOkAt: 0, rateLimitedUntil: 0 };\n    status[p.id] = { healthy: st.healthy, failCount: st.failCount, lastError: st.lastError.slice(0, 120), lastFailAt: st.lastFailAt ? new Date(st.lastFailAt).toISOString() : null, lastOkAt: st.lastOkAt ? new Date(st.lastOkAt).toISOString() : null, rateLimitedUntil: st.rateLimitedUntil && st.rateLimitedUntil > Date.now() ? new Date(st.rateLimitedUntil).toISOString() : null };`
);

replaceOnce(
  'provider request classification and GLM body options',
  `    const body = {\n      model: provider.model,\n      temperature: 0,\n      max_tokens: 2000,\n      messages: buildMessages(text, target),\n    };\n    const res = await fetch(\`${'${provider.base}'}/chat/completions\`, {\n      method: 'POST',\n      headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer ${'${env[provider.keyEnv]}'}\` },\n      body: JSON.stringify(body),\n      signal: controller.signal,\n    });\n    if (!res.ok) {\n      const raw = await res.text().catch(() => '');\n      throw new Error(\`${'${provider.id}'}: ${'${res.status}'} ${'${raw.slice(0, 100)}'}\`);\n    }\n    const data = await res.json();\n    let result = ((data.choices || [])[0] || {}).message?.content?.trim();\n    if (!result && data.choices?.[0]?.message?.reasoning) result = String(data.choices[0].message.reasoning).trim();\n    if (!result) throw new Error(\`${'${provider.id}'}: empty response\`);`,
  `    const body = {\n      model: provider.model,\n      temperature: 0,\n      max_tokens: 2000,\n      messages: buildMessages(text, target),\n      ...(provider.body || {}),\n    };\n    const res = await fetch(\`${'${provider.base}'}/chat/completions\`, {\n      method: 'POST',\n      headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer ${'${env[provider.keyEnv]}'}\` },\n      body: JSON.stringify(body),\n      signal: controller.signal,\n    });\n    if (!res.ok) {\n      const raw = await res.text().catch(() => '');\n      throw providerHttpError(provider, res, raw);\n    }\n    let data;\n    try { data = await res.json(); }\n    catch (error) { throw providerMalformedResponseError(provider, error); }\n    let result = ((data.choices || [])[0] || {}).message?.content?.trim();\n    if (!result && data.choices?.[0]?.message?.reasoning) result = String(data.choices[0].message.reasoning).trim();\n    if (!result) throw providerEmptyResponseError(provider);`
);

replaceOnce(
  'empty-after-strip typed retry and transport wrapping',
  `    if (!result) throw new Error(\`${'${provider.id}'}: empty after strip\`);\n    try { result = validateTranslationOutput(text, result, target); }\n    catch (error) { throw providerQualityError(provider, error); }\n    return { text: result, engine: provider.id };\n  } catch (error) {\n    if (controller.signal.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError') {\n      const timeout = new Error(\`${'${provider.id}'}: timeout\`);\n      timeout.code = 'provider_timeout';\n      timeout.timeoutMs = boundedTimeout;\n      throw timeout;\n    }\n    throw error;\n  } finally {\n    clearTimeout(timer);\n  }\n}\n\nasync function translate(text, target, env, deadlineAt = Date.now() + REQUEST_BUDGET_MS) {`,
  `    if (!result) throw providerEmptyResponseError(provider, 'response after strip');\n    try { result = validateTranslationOutput(text, result, target); }\n    catch (error) { throw providerQualityError(provider, error); }\n    return { text: result, engine: provider.id };\n  } catch (error) {\n    if (controller.signal.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError') {\n      const timeout = new Error(\`${'${provider.id}'}: timeout\`);\n      timeout.code = 'provider_timeout';\n      timeout.timeoutMs = boundedTimeout;\n      throw timeout;\n    }\n    if (error?.code) throw error;\n    throw providerTransportError(provider, error);\n  } finally {\n    clearTimeout(timer);\n  }\n}\n\nasync function callProviderWithRetry(provider, env, text, target, timeoutMs) {\n  const deadlineAt = Date.now() + Math.max(1, Math.floor(Number(timeoutMs) || 0));\n  let lastError = null;\n  for (let attempt = 0; attempt < 2; attempt += 1) {\n    const remaining = Math.max(0, deadlineAt - Date.now());\n    if (remaining <= 0) throw lastError || new Error(\`${'${provider.id}'}: retry budget exhausted\`);\n    const attemptTimeout = attempt === 0 ? remaining : Math.min(TRANSIENT_RETRY_MAX_MS, remaining);\n    try {\n      return await callProvider(provider, env, text, target, attemptTimeout);\n    } catch (error) {\n      lastError = error;\n      if (attempt >= 1 || !shouldRetryProviderError(error)) throw error;\n      const remainingBeforeDelay = Math.max(0, deadlineAt - Date.now() - 1);\n      const delayMs = Math.min(TRANSIENT_RETRY_DELAY_MS, remainingBeforeDelay);\n      if (delayMs <= 0) throw error;\n      await sleep(delayMs);\n    }\n  }\n  throw lastError || new Error(\`${'${provider.id}'}: provider retry exhausted\`);\n}\n\nasync function translate(text, target, env, deadlineAt = Date.now() + REQUEST_BUDGET_MS) {`
);

replaceOnce(
  'translate uses bounded retry and rate-limit quarantine',
  `      const result = await callProvider(provider, env, text, target, attemptBudget);\n      markProviderOk(provider.id);\n      return result;\n    } catch (error) {\n      const deadlineLimitedTimeout = error?.code === 'provider_timeout' && attemptBudget < PROVIDER_TIMEOUT_MS;\n      if (deadlineLimitedTimeout) throw deadlineExceededError(error);\n      if (shouldAffectProviderHealth(error)) markProviderFail(provider.id, error.message);`,
  `      const result = await callProviderWithRetry(provider, env, text, target, attemptBudget);\n      markProviderOk(provider.id);\n      return result;\n    } catch (error) {\n      const deadlineLimitedTimeout = error?.code === 'provider_timeout' && remainingBudgetMs(deadlineAt) <= FINISH_RESERVE_MS;\n      if (deadlineLimitedTimeout) throw deadlineExceededError(error);\n      if (error?.code === 'provider_rate_limited') markProviderRateLimited(provider.id, error);\n      else if (shouldAffectProviderHealth(error)) markProviderFail(provider.id, error.message);`
);

fs.writeFileSync(workerPath, worker.endsWith('\n') ? worker : `${worker}\n`);

const test = String.raw`'use strict';

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
    const result = await hooks.translate('Hello', 'it', { GEMINI_API_KEY: 'gemini-key' }, Date.now() + 30_000);
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
      hooks.translate('Hello', 'it', { GEMINI_API_KEY: 'gemini-key' }, Date.now() + 30_000),
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
      hooks.translate('Hello', 'it', { MISTRAL_API_KEY: 'mistral-key' }, Date.now() + 30_000),
      /429/
    );
    const state = hooks.providerState.get('mistral');
    assert.equal(state.failCount, 0, '429 is availability backoff, not shared provider health failure');
    assert.equal(state.healthy, true, '429 must not open the provider health circuit');
    assert.ok(state.rateLimitedUntil > Date.now() + 40_000, 'Retry-After must quarantine the provider for the advertised window');
    await assert.rejects(
      hooks.translate('Hello', 'it', { MISTRAL_API_KEY: 'mistral-key' }, Date.now() + 30_000),
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
    const result = await hooks.translate('Hello', 'it', { ZAI_API_KEY: 'glm-key' }, Date.now() + 30_000);
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
`;
fs.writeFileSync(testPath, test);

for (const file of [selfPath, workflowPath]) {
  try { fs.rmSync(file); } catch {}
}

console.log('TRANSLATION_PROVIDER_RESILIENCE_PATCH_APPLIED');

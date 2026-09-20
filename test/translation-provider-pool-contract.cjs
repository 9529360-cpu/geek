'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const workerSource = fs.readFileSync(path.join(root, 'scripts', 'geek-translate-worker.js'), 'utf8');
const executable = workerSource.replace(/^export default\s*/m, 'this.__worker = ')
  + '\nthis.__poolHooks = { PROVIDERS, translate };';

const calls = [];
const sandbox = {
  Request, Response, Headers, URL, TextEncoder, TextDecoder, AbortController,
  crypto: globalThis.crypto, btoa, atob, console, setTimeout, clearTimeout,
  fetch: async (url, init) => {
    calls.push({ type: 'fetch', url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Ciao' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
vm.createContext(sandbox);
vm.runInContext(executable, sandbox, { filename: 'scripts/geek-translate-worker.js' });

(async () => {
  const { PROVIDERS, translate } = sandbox.__poolHooks;
  assert.deepEqual(
    Array.from(PROVIDERS, provider => provider.id),
    ['gemini', 'mistral', 'openrouter', 'cloudflare', 'groq'],
    'translation fallback order must use the maintained five-provider free pool'
  );
  assert.equal(PROVIDERS.find(provider => provider.id === 'mistral').model, 'ministral-3b-latest');
  assert.equal(PROVIDERS.find(provider => provider.id === 'openrouter').model, 'openrouter/free');
  assert.equal(PROVIDERS.find(provider => provider.id === 'cloudflare').model, '@cf/meta/llama-3.1-8b-instruct-fp8');

  const cloudflareCalls = [];
  const result = await translate('Hello', 'en', 'it', {
    AI: {
      async run(model, body) {
        cloudflareCalls.push({ model, body });
        return { response: 'Ciao' };
      },
    },
  }, Date.now() + 30_000);
  assert.equal(result.engine, 'cloudflare');
  assert.equal(result.text, 'Ciao');
  assert.equal(cloudflareCalls.length, 1);
  assert.equal(cloudflareCalls[0].model, '@cf/meta/llama-3.1-8b-instruct-fp8');
  assert.equal(calls.length, 0, 'Workers AI binding must not leak through an external bearer request');

  console.log('TRANSLATION_PROVIDER_POOL_CONTRACT_OK');
})().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});

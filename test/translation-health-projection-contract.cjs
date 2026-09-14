'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const entrySource = fs.readFileSync(path.join(root, 'scripts/geek-translate-entry.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(root, 'scripts/geek-translate-worker.js'), 'utf8');

function loadEntry(baseFetch) {
  const code = entrySource
    .replace(
      "import baseWorker from './geek-translate-worker.js';",
      'const baseWorker = this.__baseWorker;'
    )
    .replace(
      "import { scopeTranslationRateLimitAuthority } from './translation-rate-limit-compat.mjs';",
      'const scopeTranslationRateLimitAuthority = this.__scopeTranslationRateLimitAuthority;'
    )
    .replace(/^export default\s*/m, 'this.__export = ');

  const sandbox = {
    Response,
    Request,
    Headers,
    URL,
    console,
    __baseWorker: { fetch: baseFetch },
    __scopeTranslationRateLimitAuthority: (db) => db,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'geek-translate-entry.js' });
  return sandbox.__export;
}

(async () => {
  assert.match(
    workerSource,
    /lastError:\s*st\.lastError\.slice\(0, 120\)/,
    '底层 Worker 必须继续保留 provider lastError 内存态，公开净化不应删除内部诊断来源'
  );
  assert.match(
    entrySource,
    /const \{ lastError: _lastError, \.\.\.safeState \} = state/,
    '生产入口必须显式从公开 provider 投影中移除 lastError'
  );
  assert.match(
    entrySource,
    /request\.method === 'GET' && url\.pathname === '\/health'/,
    '公开净化必须只绑定健康检查路由'
  );

  const sentinel = 'UPSTREAM_INTERNAL_SENTINEL project=private-account request=req_secret';
  const healthPayload = {
    ok: false,
    service: 'geek-translate',
    providers: ['gemini'],
    models: {
      gemini: {
        healthy: false,
        failCount: 2,
        lastError: sentinel,
        lastFailAt: '2026-09-13T18:30:00.000Z',
        lastOkAt: null,
      },
    },
  };

  const entry = loadEntry(async () => new Response(JSON.stringify(healthPayload), {
    status: 503,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Vary': 'Origin',
      'X-Projection-Probe': 'kept',
    },
  }));

  const health = await entry.fetch(
    new Request('https://translate.invalid/health'),
    {},
    {}
  );
  assert.equal(health.status, 503, '公开投影不得改变健康检查 HTTP 状态');
  assert.equal(health.headers.get('cache-control'), 'no-store', '公开投影必须保留原有缓存策略');
  assert.equal(health.headers.get('vary'), 'Origin', '公开投影必须保留 CORS/Vary 头');
  assert.equal(health.headers.get('x-projection-probe'), 'kept', '公开投影必须保留底层响应头');

  const raw = await health.text();
  assert.ok(!raw.includes(sentinel), '公开健康响应不得包含原始上游错误文本');
  assert.ok(!raw.includes('lastError'), '公开健康响应不得包含 lastError 字段名');
  const payload = JSON.parse(raw);
  assert.deepEqual(payload.providers, ['gemini'], '公开健康响应必须保留 configured provider IDs');
  assert.equal(payload.models.gemini.healthy, false);
  assert.equal(payload.models.gemini.failCount, 2, '公开健康响应必须保留安全健康计数');
  assert.equal(payload.models.gemini.lastFailAt, '2026-09-13T18:30:00.000Z', '公开健康响应必须保留安全时间戳');
  assert.equal(payload.models.gemini.lastOkAt, null);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.models.gemini, 'lastError'), false);

  let nonHealthResponse;
  const passthrough = loadEntry(async () => {
    nonHealthResponse = new Response(JSON.stringify({ error: 'translation_failed' }), {
      status: 502,
      headers: { 'X-Passthrough-Probe': 'yes' },
    });
    return nonHealthResponse;
  });
  const translated = await passthrough.fetch(
    new Request('https://translate.invalid/v1/translate', { method: 'POST' }),
    {},
    {}
  );
  assert.equal(translated, nonHealthResponse, '非 health 路由必须保持底层 Response 原样透传');

  console.log('TRANSLATION_HEALTH_PROJECTION_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

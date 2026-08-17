'use strict';
// 行为测试：发布 Worker 安全基线
// - /__debug 必须返回 404（完全移除，不是隐藏路径）
// - 错误响应不得回显内部异常、R2 key 或绑定信息
// - 正常对象仍可下载；404 不回显请求 key
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const workerPath = path.join(__dirname, '../scripts/geek-release-worker.js');

// Worker 是 ESM（export default），用 vm 剥离 ESM 语法后加载 fetch 处理器
function loadWorker() {
  const code = fs.readFileSync(workerPath, 'utf8')
    .replace(/^export default\s*/m, 'this.__export = ')
    .replace(/^import\b.*$/gm, '');
  const sandbox = {
    Response,
    Request,
    Headers,
    URL,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: workerPath });
  const handler = sandbox.__export && sandbox.__export.fetch;
  assert.ok(typeof handler === 'function', 'Worker 必须导出 fetch 处理器');
  return handler;
}

(async () => {
  const fetchHandler = loadWorker();
  const nullBucket = { get: async () => null, list: async () => ({ objects: [], truncated: false }) };

  // 1. /__debug 必须返回 404（完全移除 + 保留名拒绝，不依赖对象是否存在）
  const debugRes = await fetchHandler(
    new Request('https://geek-release.9529360.workers.dev/__debug'),
    { RELEASE_BUCKET: { get: async () => ({ key: '__debug' }), list: async () => ({ objects: [] }) } }
  );
  assert.equal(debugRes.status, 404, '/__debug 必须返回 404（即使对象存在也不服务）');

  // 2. 任意隐藏端点（__debug 变体、点开头、下划线、含斜杠）都不得泄露绑定信息
  for (const p of ['/__debug', '/.debug', '/__debug/', '/__debug?x=1', '/a/b', '/.well-known/x', '/_debug']) {
    const res = await fetchHandler(
      new Request(`https://geek-release.9529360.workers.dev${p}`),
      { RELEASE_BUCKET: nullBucket }
    );
    assert.equal(res.status, 404, `路径 ${p} 必须 404`);
    const body = await res.text();
    assert.ok(!body.includes('RELEASE_BUCKET') && !body.includes('bindings'), `${p} 响应不得包含绑定信息`);
  }

  // 3. 错误路径：R2 get 抛错 → 500 且不回显内部异常/对象 key
  const errRes = await fetchHandler(
    new Request('https://geek-release.9529360.workers.dev/latest.yml'),
    { RELEASE_BUCKET: { get: async () => { throw new Error('secret-internal: bucket=release-prod key=latest.yml'); } } }
  );
  assert.equal(errRes.status, 500, '内部错误必须返回 500');
  const errBody = await errRes.text();
  assert.ok(!errBody.includes('secret-internal'), '错误响应不得回显内部异常');
  assert.ok(!errBody.includes('latest.yml'), '错误响应不得回显对象 key');
  assert.ok(!errBody.includes('RELEASE_BUCKET'), '错误响应不得回显绑定名');

  // 4. 404 路径：对象不存在 → 404 且不回显请求 key
  const missRes = await fetchHandler(
    new Request('https://geek-release.9529360.workers.dev/geek-setup-9.9.9.exe'),
    { RELEASE_BUCKET: nullBucket }
  );
  assert.equal(missRes.status, 404, '对象不存在必须 404');
  const missBody = await missRes.text();
  assert.ok(!missBody.includes('geek-setup-9.9.9.exe'), '404 响应不得回显请求 key');

  // 5. 正常对象仍可下载（不破坏发布功能）
  const obj = {
    body: 'latest: 1.2.4',
    httpEtag: '"etag-abc"',
    writeHttpMetadata(headers) { headers.set('x-test', '1'); },
  };
  const okRes = await fetchHandler(
    new Request('https://geek-release.9529360.workers.dev/latest.yml'),
    { RELEASE_BUCKET: { get: async (k) => (k === 'latest.yml' ? obj : null) } }
  );
  assert.equal(okRes.status, 200, '正常对象必须可下载');
  assert.equal(await okRes.text(), 'latest: 1.2.4', '对象内容必须原样返回');

  console.log('RELEASE_WORKER_SECURITY_CONTRACT_OK');
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});

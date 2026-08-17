'use strict';
// 行为测试：发布 Worker 安全基线
// - /__debug 必须返回 404（完全移除，不是隐藏路径）
// - 只允许 latest.yml / geek-setup-x.y.z.exe / 对应 blockmap
// - 错误响应不得回显内部异常、R2 key 或绑定信息
// - 版本化产物使用 immutable 缓存并发送 nosniff
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

function releaseObject(body = 'artifact') {
  return {
    body,
    httpEtag: '"etag-abc"',
    writeHttpMetadata(headers) { headers.set('x-test', '1'); },
  };
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

  // 2. 隐藏端点、路径穿越形态以及任意非更新产物都必须 404。
  // 即使对象真实存在于 R2，也不能通过公开 Worker 取出。
  for (const p of [
    '/__debug', '/.debug', '/__debug/', '/__debug?x=1', '/a/b', '/.well-known/x', '/_debug',
    '/index.html', '/release-manifest.json', '/notes.txt', '/geek-setup-latest.exe',
    '/geek-setup-1.2.exe', '/geek-setup-1.2.3.zip', '/geek-setup-1.2.3.exe.sha256'
  ]) {
    const res = await fetchHandler(
      new Request(`https://geek-release.9529360.workers.dev${p}`),
      { RELEASE_BUCKET: { get: async () => releaseObject('must-not-leak'), list: async () => ({ objects: [] }) } }
    );
    assert.equal(res.status, 404, `路径 ${p} 必须 404`);
    const body = await res.text();
    assert.ok(!body.includes('must-not-leak'), `${p} 不得返回 R2 对象内容`);
    assert.ok(!body.includes('RELEASE_BUCKET') && !body.includes('bindings'), `${p} 响应不得包含绑定信息`);
  }

  // 3. 错误路径：允许的 key 在 R2 get 阶段抛错 → 500 且不回显内部异常/对象 key
  const errRes = await fetchHandler(
    new Request('https://geek-release.9529360.workers.dev/latest.yml'),
    { RELEASE_BUCKET: { get: async () => { throw new Error('secret-internal: bucket=release-prod key=latest.yml'); } } }
  );
  assert.equal(errRes.status, 500, '内部错误必须返回 500');
  const errBody = await errRes.text();
  assert.ok(!errBody.includes('secret-internal'), '错误响应不得回显内部异常');
  assert.ok(!errBody.includes('latest.yml'), '错误响应不得回显对象 key');
  assert.ok(!errBody.includes('RELEASE_BUCKET'), '错误响应不得回显绑定名');

  // 4. 允许的对象不存在 → 404 且不回显请求 key
  const missRes = await fetchHandler(
    new Request('https://geek-release.9529360.workers.dev/geek-setup-9.9.9.exe'),
    { RELEASE_BUCKET: nullBucket }
  );
  assert.equal(missRes.status, 404, '对象不存在必须 404');
  const missBody = await missRes.text();
  assert.ok(!missBody.includes('geek-setup-9.9.9.exe'), '404 响应不得回显请求 key');

  // 5. latest.yml 正常下载，短缓存，且启用 nosniff。
  const latest = releaseObject('version: 1.2.6');
  const latestRes = await fetchHandler(
    new Request('https://geek-release.9529360.workers.dev/latest.yml'),
    { RELEASE_BUCKET: { get: async (k) => (k === 'latest.yml' ? latest : null) } }
  );
  assert.equal(latestRes.status, 200, 'latest.yml 必须可下载');
  assert.equal(await latestRes.text(), 'version: 1.2.6', 'latest.yml 内容必须原样返回');
  assert.equal(latestRes.headers.get('cache-control'), 'public, max-age=60');
  assert.equal(latestRes.headers.get('x-content-type-options'), 'nosniff');
  assert.match(latestRes.headers.get('content-type') || '', /^text\/yaml/i);

  // 6. 版本化 installer / blockmap 必须可下载并长期 immutable 缓存。
  for (const key of ['geek-setup-1.2.6.exe', 'geek-setup-1.2.6.exe.blockmap']) {
    const res = await fetchHandler(
      new Request(`https://geek-release.9529360.workers.dev/${key}`),
      { RELEASE_BUCKET: { get: async (k) => (k === key ? releaseObject(key) : null) } }
    );
    assert.equal(res.status, 200, `${key} 必须可下载`);
    assert.equal(await res.text(), key, `${key} 内容必须原样返回`);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('content-type'), 'application/octet-stream');
  }

  console.log('RELEASE_WORKER_SECURITY_CONTRACT_OK');
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});

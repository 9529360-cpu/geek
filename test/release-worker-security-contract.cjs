'use strict';
// 行为测试：发布 Worker 安全基线 + electron-updater 字节范围契约
// - /__debug 必须返回 404（完全移除，不是隐藏路径）
// - 只允许 latest.yml / geek-setup-x.y.z.exe / 对应 blockmap
// - 错误响应不得回显内部异常、R2 key 或绑定信息
// - 版本化产物使用 immutable 缓存并发送 nosniff
// - GET/HEAD 只读；单 Range 返回 206；非法/多 Range 返回 416
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const workerPath = path.join(root, 'scripts/geek-release-worker.js');
const builderPath = path.join(root, 'electron-builder.yml');

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

function releaseObject(body = 'artifact', options = {}) {
  const size = Number.isSafeInteger(options.size)
    ? options.size
    : Buffer.byteLength(String(body ?? ''));
  return {
    body,
    size,
    range: options.range,
    httpEtag: '"etag-abc"',
    writeHttpMetadata(headers) { headers.set('x-test', '1'); },
  };
}

function releaseBucket(key, body) {
  const source = String(body);
  const calls = { head: [], get: [] };
  return {
    calls,
    async head(requestedKey) {
      calls.head.push(requestedKey);
      return requestedKey === key ? releaseObject(null, { size: Buffer.byteLength(source) }) : null;
    },
    async get(requestedKey, options) {
      calls.get.push({ key: requestedKey, options });
      if (requestedKey !== key) return null;
      const range = options?.range;
      if (!range) return releaseObject(source);
      const start = range.offset;
      const end = start + range.length;
      return releaseObject(source.slice(start, end), {
        size: Buffer.byteLength(source),
        range: { offset: start, length: range.length },
      });
    },
  };
}

(async () => {
  const fetchHandler = loadWorker();
  const nullBucket = { get: async () => null, head: async () => null, list: async () => ({ objects: [], truncated: false }) };

  // 1. /__debug 必须返回 404（完全移除 + 保留名拒绝，不依赖对象是否存在）
  const debugRes = await fetchHandler(
    new Request('https://geek-release.9529360.workers.dev/__debug'),
    { RELEASE_BUCKET: { get: async () => ({ key: '__debug' }), head: async () => ({ key: '__debug' }), list: async () => ({ objects: [] }) } }
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
      { RELEASE_BUCKET: { get: async () => releaseObject('must-not-leak'), head: async () => releaseObject('must-not-leak') } }
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

  // 4. 允许的 key 在 R2 head 阶段抛错同样不得泄密。
  const headErrRes = await fetchHandler(
    new Request('https://geek-release.9529360.workers.dev/latest.yml', { method: 'HEAD' }),
    { RELEASE_BUCKET: { head: async () => { throw new Error('secret-head-error latest.yml'); } } }
  );
  assert.equal(headErrRes.status, 500, 'HEAD 内部错误必须返回 500');
  assert.ok(!((await headErrRes.text()) || '').includes('secret-head-error'), 'HEAD 错误不得回显内部异常');

  // 5. 允许的对象不存在 → 404 且不回显请求 key
  const missRes = await fetchHandler(
    new Request('https://geek-release.9529360.workers.dev/geek-setup-9.9.9.exe'),
    { RELEASE_BUCKET: nullBucket }
  );
  assert.equal(missRes.status, 404, '对象不存在必须 404');
  const missBody = await missRes.text();
  assert.ok(!missBody.includes('geek-setup-9.9.9.exe'), '404 响应不得回显请求 key');

  // 6. latest.yml 正常下载，短缓存，且启用 nosniff / Accept-Ranges。
  const latest = releaseObject('version: 1.2.6');
  const latestRes = await fetchHandler(
    new Request('https://geek-release.9529360.workers.dev/latest.yml'),
    { RELEASE_BUCKET: { get: async (k) => (k === 'latest.yml' ? latest : null) } }
  );
  assert.equal(latestRes.status, 200, 'latest.yml 必须可下载');
  assert.equal(await latestRes.text(), 'version: 1.2.6', 'latest.yml 内容必须原样返回');
  assert.equal(latestRes.headers.get('cache-control'), 'public, max-age=60');
  assert.equal(latestRes.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(latestRes.headers.get('accept-ranges'), 'bytes');
  assert.match(latestRes.headers.get('content-type') || '', /^text\/yaml/i);

  // 7. 版本化 installer / blockmap 必须可下载并长期 immutable 缓存。
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
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
  }

  // 8. HEAD 只读元数据：必须调用 R2 head，不得调用 get/读取正文。
  {
    const key = 'geek-setup-1.2.6.exe';
    const bucket = releaseBucket(key, '0123456789');
    const res = await fetchHandler(
      new Request(`https://geek-release.9529360.workers.dev/${key}`, { method: 'HEAD' }),
      { RELEASE_BUCKET: bucket }
    );
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '');
    assert.equal(res.headers.get('content-length'), '10');
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.deepEqual(bucket.calls.head, [key]);
    assert.deepEqual(bucket.calls.get, [], 'HEAD 不得触发 R2 body 读取');
  }

  // 9. 单字节范围：固定、开放尾部、suffix 以及越界 end 都必须标准化为精确 206。
  const rangeCases = [
    { header: 'bytes=2-5', expected: '2345', contentRange: 'bytes 2-5/10', range: { offset: 2, length: 4 } },
    { header: 'bytes=7-', expected: '789', contentRange: 'bytes 7-9/10', range: { offset: 7, length: 3 } },
    { header: 'bytes=-3', expected: '789', contentRange: 'bytes 7-9/10', range: { offset: 7, length: 3 } },
    { header: 'bytes=8-99', expected: '89', contentRange: 'bytes 8-9/10', range: { offset: 8, length: 2 } },
  ];
  for (const testCase of rangeCases) {
    const key = 'geek-setup-1.2.6.exe';
    const bucket = releaseBucket(key, '0123456789');
    const res = await fetchHandler(
      new Request(`https://geek-release.9529360.workers.dev/${key}`, { headers: { Range: testCase.header } }),
      { RELEASE_BUCKET: bucket }
    );
    assert.equal(res.status, 206, `${testCase.header} 必须返回 206`);
    assert.equal(await res.text(), testCase.expected);
    assert.equal(res.headers.get('content-range'), testCase.contentRange);
    assert.equal(res.headers.get('content-length'), String(testCase.range.length));
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.equal(bucket.calls.get.length, 1, `${testCase.header} 必须只读取一个 R2 范围`);
    assert.equal(bucket.calls.get[0].key, key, `${testCase.header} 必须读取正确对象`);
    assert.equal(bucket.calls.get[0].options?.range?.offset, testCase.range.offset, `${testCase.header} R2 offset 必须精确`);
    assert.equal(bucket.calls.get[0].options?.range?.length, testCase.range.length, `${testCase.header} R2 length 必须精确`);
  }

  // 10. 无效/不可满足/多 Range 必须 416，且不能触发 R2 body 读取。
  for (const header of ['bytes=10-', 'bytes=5-4', 'bytes=-0', 'items=0-1', 'bytes=0-1,4-5']) {
    const key = 'geek-setup-1.2.6.exe';
    const bucket = releaseBucket(key, '0123456789');
    const res = await fetchHandler(
      new Request(`https://geek-release.9529360.workers.dev/${key}`, { headers: { Range: header } }),
      { RELEASE_BUCKET: bucket }
    );
    assert.equal(res.status, 416, `${header} 必须 fail closed 为 416`);
    assert.equal(res.headers.get('content-range'), 'bytes */10');
    assert.equal(res.headers.get('content-length'), '0');
    assert.deepEqual(bucket.calls.get, [], `${header} 不得读取 R2 body`);
  }

  // 11. Release Worker 是公开只读边界，非 GET/HEAD 方法必须在碰 R2 前拒绝。
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    let touched = false;
    const res = await fetchHandler(
      new Request('https://geek-release.9529360.workers.dev/latest.yml', { method }),
      { RELEASE_BUCKET: { get: async () => { touched = true; }, head: async () => { touched = true; } } }
    );
    assert.equal(res.status, 405, `${method} 必须返回 405`);
    assert.equal(res.headers.get('allow'), 'GET, HEAD');
    assert.equal(touched, false, `${method} 不得触碰 R2`);
  }

  // 12. future client config 必须显式使用单 Range；版本 authority 只能来自正式客户端版本 + release marker 的同步关系。
  const builder = fs.readFileSync(builderPath, 'utf8');
  assert.match(builder, /provider:\s*generic[\s\S]*url:\s*https:\/\/geek-release\.9529360\.workers\.dev[\s\S]*useMultipleRangeRequest:\s*false/, 'generic updater 必须明确使用单 Range 差分下载');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const releaseMarker = fs.readFileSync(path.join(root, '.github/release-client-version'), 'utf8').trim();
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, '客户端版本必须是标准 semver 三段版本');
  assert.equal(releaseMarker, pkg.version, 'Release Worker Range 契约不得建立独立版本 authority；正式 release marker 必须与客户端版本同步');

  console.log('RELEASE_WORKER_SECURITY_CONTRACT_OK');
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});

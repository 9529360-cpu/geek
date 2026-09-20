'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
// Source-contract parsing must be checkout-EOL agnostic: GitHub Windows runners may
// materialize CRLF while Linux CI reads LF. Normalize before locating function boundaries.
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n?/g, '\n');
const workerSource = read('scripts/geek-translate-worker.js');
const subscriptionSource = [
  read('scripts/geek-subscription-worker.js'),
  read('scripts/geek-subscription-worker-core.js'),
].join('\n');
const runtimeOwnerSource = read('src/translation-runtime.cjs');
const runtimeBaseSource = read('src/translation-runtime-base.cjs');
const schema = read('scripts/geek-subscription-schema.sql');

function loadWorker() {
  const code = workerSource.replace(/^export default\s*/m, 'this.__export = ');
  let upstreamCalls = 0;
  const sandbox = {
    Response, Request, Headers, URL, TextEncoder, TextDecoder, crypto,
    btoa, atob, console,
    fetch: async () => { upstreamCalls += 1; throw new Error('upstream must not be called'); },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'geek-translate-worker.js' });
  return { handler: sandbox.__export.fetch, upstreamCalls: () => upstreamCalls };
}

(async () => {
  assert.doesNotMatch(workerSource, /Access-Control-Allow-Origin['"]?\s*:\s*['"]\*['"]/, '翻译 Worker 不得允许任意来源 CORS');
  assert.match(workerSource, /payload\.aud !== 'geek-translate'/, '必须校验令牌 audience');
  assert.match(workerSource, /payload\.purpose !== 'translate'/, '必须校验令牌 purpose');
  const reserveStart = workerSource.indexOf('async function reserveUsage(');
  const reserveEnd = workerSource.indexOf('\n}\n\nasync function refundUsage', reserveStart);
  assert.ok(reserveStart >= 0 && reserveEnd > reserveStart, '额度预扣实现必须可检查');
  const reserveBody = workerSource.slice(reserveStart, reserveEnd);
  assert.match(
    reserveBody,
    /db\.batch\(\[[\s\S]*WHERE id = \? AND status = 'active' AND quota_chars >= \?[\s\S]*SET quota_chars = quota_chars - \?[\s\S]*WHERE request_id = \? AND user_id = \? AND reserved_chars = \? AND status = \?/,
    '额度预扣必须在同一事务中先校验余额，再只对精确 owner reservation 扣减'
  );
  assert.match(workerSource, /translation_usage/, '必须用请求记录保证幂等');
  assert.match(schema, /request_id TEXT PRIMARY KEY/, '请求 ID 必须数据库唯一');
  assert.match(subscriptionSource, /aud:\s*'geek-translate'/, '订阅 Worker 必须签发限定 audience 的短期令牌');
  assert.match(subscriptionSource, /exp:\s*now \+ 5 \* 60/, '翻译令牌有效期必须为 5 分钟');
  assert.match(runtimeOwnerSource, /translation-runtime-base\.cjs/, '公共 Runtime 必须通过唯一内部事务层完成授权和网关调用');
  assert.match(runtimeBaseSource, /getRemoteAuthorizationLease\(subscriptionStore, deadlineAt\)/, '远程翻译必须先取得当前订阅会话的授权 lease');
  assert.match(runtimeBaseSource, /headers\.Authorization = `Bearer \$\{remoteAuthorizationLease\?\.token \|\| ''\}`/, '远程翻译 Bearer token 必须来自当前授权 lease');
  assert.match(runtimeBaseSource, /assertRemoteAuthorizationCurrent\(subscriptionStore, remoteAuthorizationLease\)/, '远程翻译必须重验授权 lease 生命周期');
  assert.match(runtimeBaseSource, /const needsRemoteAuthorization = pool\.endpoints\.some/, 'Translation Runtime 必须只在远程网关需要授权时取短期令牌');
  assert.match(runtimeBaseSource, /parsed\.protocol === 'http:' && parsed\.hostname === '127\.0\.0\.1'/, '本地回环网关必须保持无远程凭据例外');
  assert.match(runtimeBaseSource, /'X-Request-ID': requestId/, '每次翻译必须携带幂等请求 ID');
  assert.doesNotMatch(runtimeBaseSource, /reportUsage\(/, 'Translation Runtime 不得在服务端扣费后再次上报扣费');

  const worker = loadWorker();
  const env = { GEMINI_API_KEY: 'configured', JWT_SECRET: 'secret', geek_subscriptions: {} };
  const unauthorized = await worker.handler(new Request('https://translate.invalid/v1/translate', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Request-ID': crypto.randomUUID() }, body: JSON.stringify({ text: 'hello', target: 'zh' }),
  }), env);
  assert.equal(unauthorized.status, 401, '无短期令牌必须在触发上游前拒绝');
  assert.equal(worker.upstreamCalls(), 0, '无令牌请求不得调用上游');

  const health = await worker.handler(new Request('https://translate.invalid/health'), env);
  assert.equal(health.status, 200, '配置齐全时健康检查应成功');
  assert.equal(worker.upstreamCalls(), 0, '健康检查不得调用计费上游');

  console.log('TRANSLATION_GATEWAY_AUTH_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

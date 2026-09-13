'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const workerSource = fs.readFileSync(path.join(root, 'scripts/geek-translate-worker.js'), 'utf8');
const subscriptionSource = [
  fs.readFileSync(path.join(root, 'scripts/geek-subscription-worker.js'), 'utf8'),
  fs.readFileSync(path.join(root, 'scripts/geek-subscription-worker-core.js'), 'utf8'),
].join('\n');
const runtimeSource = fs.readFileSync(path.join(root, 'src/translation-runtime.cjs'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'scripts/geek-subscription-schema.sql'), 'utf8');

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
  assert.match(runtimeSource, /headers\.Authorization = `Bearer \$\{remoteAuthorization\}`/, '远程翻译必须携带短期 Bearer token');
  assert.match(runtimeSource, /const needsRemoteAuthorization = pool\.endpoints\.some/, 'Translation Runtime 必须只在远程网关需要授权时取短期令牌');
  assert.match(runtimeSource, /parsed\.protocol === 'http:' && parsed\.hostname === '127\.0\.0\.1'/, '本地回环网关必须保持无远程凭据例外');
  assert.match(runtimeSource, /'X-Request-ID': requestId/, '每次翻译必须携带幂等请求 ID');
  assert.doesNotMatch(runtimeSource, /reportUsage\(/, 'Translation Runtime 不得在服务端扣费后再次上报扣费');

  const worker = loadWorker();
  const env = { ZAI_API_KEY: 'configured', JWT_SECRET: 'secret', geek_subscriptions: {} };
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

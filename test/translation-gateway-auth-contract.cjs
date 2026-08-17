'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const workerSource = fs.readFileSync(path.join(root, 'scripts/geek-translate-worker.js'), 'utf8');
const subscriptionSource = fs.readFileSync(path.join(root, 'scripts/geek-subscription-worker.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'src/main.cjs'), 'utf8');
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
  assert.match(workerSource, /quota_chars\s*=\s*quota_chars\s*-\s*\?[^;]+quota_chars\s*>=\s*\?/s, '额度预扣必须是带余额条件的原子 UPDATE');
  assert.match(workerSource, /translation_usage/, '必须用请求记录保证幂等');
  assert.match(schema, /request_id TEXT PRIMARY KEY/, '请求 ID 必须数据库唯一');
  assert.match(subscriptionSource, /aud:\s*'geek-translate'/, '订阅 Worker 必须签发限定 audience 的短期令牌');
  assert.match(subscriptionSource, /exp:\s*now \+ 5 \* 60/, '翻译令牌有效期必须为 5 分钟');
  assert.match(mainSource, /headers\.Authorization = `Bearer \$\{remoteAuthorization\}`/, '远程翻译必须携带短期 Bearer token');
  assert.match(mainSource, /'X-Request-ID': translationRequestId/, '每次翻译必须携带幂等请求 ID');
  assert.doesNotMatch(mainSource.slice(mainSource.indexOf('async function translateViaRemoteGateway'), mainSource.indexOf('function registerIpcHandlers')), /reportUsage\(/, '主进程不得在服务端扣费后再次上报扣费');

  const worker = loadWorker();
  const env = { DEEPSEEK_API_KEY: 'configured', JWT_SECRET: 'secret', geek_subscriptions: {} };
  const unauthorized = await worker.handler(new Request('https://translate.invalid/v1/translate', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Request-ID': crypto.randomUUID() }, body: JSON.stringify({ text: 'hello', target: 'zh' }),
  }), env);
  assert.equal(unauthorized.status, 401, '无短期令牌必须在触发上游前拒绝');
  assert.equal(worker.upstreamCalls(), 0, '无令牌请求不得调用 DeepSeek');

  const health = await worker.handler(new Request('https://translate.invalid/health'), env);
  assert.equal(health.status, 200, '配置齐全时健康检查应成功');
  assert.equal(worker.upstreamCalls(), 0, '健康检查不得调用计费上游');

  console.log('TRANSLATION_GATEWAY_AUTH_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

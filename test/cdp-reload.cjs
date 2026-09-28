'use strict';

const http = require('node:http');

const DEBUG_URL = 'http://127.0.0.1:9344/json';
const DEFAULT_WAIT_MS = 5000;
const DEFAULT_RETRY_MS = 100;

function getJson(url, httpModule = http) {
  return new Promise((resolve, reject) => {
    const request = httpModule.get(url, (res) => {
      let body = '';
      res.setEncoding?.('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode !== 200) {
          reject(Object.assign(new Error('CDP_HTTP_STATUS'), { code: 'CDP_HTTP_STATUS' }));
          return;
        }
        try { resolve(JSON.parse(body)); }
        catch { reject(Object.assign(new Error('CDP_JSON_INVALID'), { code: 'CDP_JSON_INVALID' })); }
      });
    });
    request.on('error', reject);
    request.setTimeout?.(1000, () => request.destroy(Object.assign(new Error('CDP_HTTP_TIMEOUT'), { code: 'CDP_HTTP_TIMEOUT' })));
  });
}

function selectHostTarget(targets, titleSub = '极客') {
  return (Array.isArray(targets) ? targets : []).find(
    target => target?.type === 'page' && String(target.title || '').includes(String(titleSub || '极客')),
  ) || null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHostTarget(titleSub = '极客', options = {}) {
  const getTargets = options.getTargets || (() => getJson(DEBUG_URL));
  const now = options.now || Date.now;
  const sleepFn = options.sleep || sleep;
  const maxWaitMs = Number.isFinite(options.maxWaitMs) ? Math.max(0, options.maxWaitMs) : DEFAULT_WAIT_MS;
  const retryMs = Number.isFinite(options.retryMs) ? Math.max(0, options.retryMs) : DEFAULT_RETRY_MS;
  const deadline = now() + maxWaitMs;
  let lastCategory = 'NO_TARGET';

  while (true) {
    try {
      const target = selectHostTarget(await getTargets(), titleSub);
      if (target) return target;
      lastCategory = 'NO_TARGET';
    } catch (error) {
      lastCategory = String(error?.code || error?.name || 'CDP_UNAVAILABLE').slice(0, 80);
    }
    if (now() >= deadline) {
      throw Object.assign(new Error('CDP_HOST_TARGET_TIMEOUT'), { code: 'CDP_HOST_TARGET_TIMEOUT', category: lastCategory });
    }
    await sleepFn(retryMs);
  }
}

async function main(argv = process.argv.slice(2)) {
  const titleSub = argv[0] || '极客';
  const target = await waitForHostTarget(titleSub);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await Promise.race([
    new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; }),
    sleep(3000).then(() => { throw Object.assign(new Error('CDP_CONNECT_TIMEOUT'), { code: 'CDP_CONNECT_TIMEOUT' }); }),
  ]);
  ws.send(JSON.stringify({ id: 1, method: 'Page.reload', params: { ignoreCache: true } }));
  await sleep(500);
  ws.close();
  process.stdout.write('HARD_RELOADED\n');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('FATAL', String(error?.code || error?.message || 'CDP_RELOAD_FAILED'));
    process.exit(1);
  });
}

module.exports = {
  DEBUG_URL,
  getJson,
  selectHostTarget,
  waitForHostTarget,
  main,
};

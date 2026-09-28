'use strict';

const fs = require('node:fs');
const http = require('node:http');

const ALLOWED_TARGET_TYPES = new Set(['page', 'webview']);

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

function parseTargetType(value) {
  const type = String(value || 'page').toLowerCase();
  if (!ALLOWED_TARGET_TYPES.has(type)) throw new Error('TARGET_TYPE_INVALID');
  return type;
}

function selectTarget(targets, titleSub, targetType = 'page') {
  const type = parseTargetType(targetType);
  return (Array.isArray(targets) ? targets : []).find(
    target => target?.type === type && String(target.title || '').includes(String(titleSub || '')),
  ) || null;
}

async function main(argv = process.argv.slice(2)) {
  const [titleSub, jsFile, rawTargetType] = argv;
  if (!titleSub || !jsFile) {
    console.error('usage: node cdp-eval.cjs <title-sub> <jsfile|-> [page|webview]');
    process.exit(1);
  }
  const targetType = parseTargetType(rawTargetType);
  const targets = await getJson('http://127.0.0.1:9344/json');
  const target = selectTarget(targets, titleSub, targetType);
  if (!target) {
    console.error('NO_TARGET for: ' + titleSub + ' type=' + targetType);
    process.exit(2);
  }
  const code = jsFile === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(jsFile, 'utf8');

  const WebSocketCtor = globalThis.WebSocket;
  const ws = new WebSocketCtor(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
    }
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const messageId = ++id;
      pending.set(messageId, { resolve, reject });
      ws.send(JSON.stringify({ id: messageId, method, params }));
    });
  }
  await send('Runtime.enable');
  const response = await send('Runtime.evaluate', {
    expression: code,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    console.error('EXCEPTION:', JSON.stringify(response.exceptionDetails.exception?.description || response.exceptionDetails.text));
    process.exit(3);
  }
  const value = response.result && response.result.value;
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  ws.close();
}

if (require.main === module) {
  main().catch(error => { console.error('FATAL', error.message); process.exit(4); });
}

module.exports = {
  ALLOWED_TARGET_TYPES,
  parseTargetType,
  selectTarget,
  main,
};

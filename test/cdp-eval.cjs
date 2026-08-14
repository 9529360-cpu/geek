// CDP eval helper: node cdp-eval.js <title-substring> <js-file-or-'-'>
// 连接 9344 端口的某个 target，在页面执行 JS，打印返回值
const http = require('http');

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function main() {
  const [titleSub, jsFile] = process.argv.slice(2);
  if (!titleSub || !jsFile) { console.error('usage: node cdp-eval.js <title-sub> <jsfile|->'); process.exit(1); }
  const targets = await getJson('http://127.0.0.1:9344/json');
  const t = targets.find(x => (x.title || '').includes(titleSub) && x.type === 'page');
  if (!t) { console.error('NO_TARGET for: ' + titleSub); process.exit(2); }
  const code = jsFile === '-' ? require('fs').readFileSync(0, 'utf8') : require('fs').readFileSync(jsFile, 'utf8');

  const WebSocket = globalThis.WebSocket;
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  }
  await send('Runtime.enable');
  const r = await send('Runtime.evaluate', {
    expression: code,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (r.exceptionDetails) {
    console.error('EXCEPTION:', JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    process.exit(3);
  }
  const v = r.result && r.result.value;
  console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  ws.close();
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(4); });

// CDP hard reload: node cdp-reload.cjs <title-sub>
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
(async () => {
  const titleSub = process.argv[2] || '极客';
  const targets = await getJson('http://127.0.0.1:9344/json');
  const t = targets.find(x => (x.title || '').includes(titleSub) && x.type === 'page');
  if (!t) { console.error('NO_TARGET'); process.exit(1); }
  const WebSocket = globalThis.WebSocket;
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.send(JSON.stringify({ id: 1, method: 'Page.reload', params: { ignoreCache: true } }));
  await new Promise(r => setTimeout(r, 500));
  ws.close();
  console.log('HARD_RELOADED');
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });

const http = require('http');
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = ''; res.on('data', (c) => d += c); res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}
(async () => {
  const targets = await getJson('http://127.0.0.1:9344/json');
  const pages = targets.filter(t => t.type === 'page');
  for (const p of pages) {
    console.log(p.url.slice(0, 90));
  }
  console.log('---WEBVIEWS---');
  const main = pages.find(t => t.url.includes('index.html'));
  if (!main) { console.log('NO_MAIN'); return; }
  const ws = new (require('ws'))(main.webSocketDebuggerUrl);
  let id = 0;
  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++id;
    ws.send(JSON.stringify({ id: mid, method, params }));
    const h = (raw) => {
      const m = JSON.parse(raw);
      if (m.id === mid) { ws.off('message', h); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    };
    ws.on('message', h);
  });
  ws.on('open', async () => {
    try {
      const r = await send('Runtime.evaluate', { expression: `JSON.stringify([...document.querySelectorAll('webview')].map(w => ({ src: (w.getAttribute('src')||'').slice(0,70), disp: getComputedStyle(w).display, vis: getComputedStyle(w).visibility, z: getComputedStyle(w).zIndex, rect: JSON.stringify(w.getBoundingClientRect().toJSON ? w.getBoundingClientRect() : '') })))`, returnByValue: true });
      console.log(r.result.value);
    } catch (e) { console.log('ERR', e.message); }
    ws.close();
  });
})();

const http = require('http');
const fs = require('fs');
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
  const page = targets.find(t => t.type === 'page' && t.url.includes('index.html'));
  if (!page) { console.log('NO_MAIN_PAGE'); return; }
  const ws = new (require('ws'))(page.webSocketDebuggerUrl);
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
      await send('Page.reload');
      await new Promise(r => setTimeout(r, 2500));
      const info = await send('Runtime.evaluate', { expression: `JSON.stringify({
        sidebarBg: getComputedStyle(document.querySelector('.side-nav')).backgroundColor,
        topbarBg: getComputedStyle(document.querySelector('.top-bar')).backgroundColor,
        topbarH: document.querySelector('.top-bar').getBoundingClientRect().height,
        quickBtns: document.querySelectorAll('.quick-btn').length,
        accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        hasMacCss: !!document.querySelector('link[href*="style-mac"]')
      })`, returnByValue: true });
      console.log('INFO', info.result.value);
      await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false });
      await new Promise(r => setTimeout(r, 1200));
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync('D:/项目/whatsapp-multi-phase1/docs/极客UI-v6-真实效果.png', Buffer.from(shot.data, 'base64'));
      console.log('SHOT_SAVED');
    } catch (e) { console.log('ERR', e.message); }
    ws.close();
  });
})();

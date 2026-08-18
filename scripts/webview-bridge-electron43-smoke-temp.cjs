'use strict';

const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const path = require('node:path');

const bridgePreload = path.join(__dirname, '..', 'resources', 'bridge-preload.cjs');
let server = null;
let win = null;

function page(body) {
  return `<!doctype html><meta charset="utf-8"><body>${body}</body>`;
}

function startServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (req.url === '/host') {
        const port = server.address().port;
        res.end(page(`
          <webview id="guest" src="http://127.0.0.1:${port}/guest" style="width:400px;height:300px"></webview>
          <script>
            window.__bridgeSmokeResult = '';
            const guest = document.getElementById('guest');
            guest.addEventListener('ipc-message', (event) => {
              const payload = event.args && event.args[0];
              if (event.channel === 'geek-bridge' && payload && payload.type === 'probe' && payload.value === 'electron43') {
                window.__bridgeSmokeResult = 'PASS';
              }
            });
            guest.addEventListener('did-fail-load', (event) => {
              window.__bridgeSmokeResult = 'FAIL_LOAD_' + String(event.errorCode || 'unknown');
            });
          <\/script>
        `));
        return;
      }
      if (req.url === '/guest') {
        res.end(page(`
          <script>
            setTimeout(() => {
              window.postMessage({ __geekBridge: true, payload: { type: 'probe', value: 'electron43' } }, window.location.origin);
            }, 150);
          <\/script>
        `));
        return;
      }
      res.statusCode = 404;
      res.end('not found');
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function waitForResult(timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await win.webContents.executeJavaScript('window.__bridgeSmokeResult || ""', true).catch(() => '');
    if (result) return String(result);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return 'TIMEOUT';
}

async function run() {
  const port = await startServer();
  win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: true,
    },
  });

  win.webContents.on('will-attach-webview', (_event, webPreferences, params) => {
    webPreferences.preload = bridgePreload;
    webPreferences.contextIsolation = false;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    params.webpreferences = 'contextIsolation=no,sandbox=true,nativeWindowOpen=yes,spellcheck=no';
  });

  await win.loadURL(`http://127.0.0.1:${port}/host`);
  const result = await waitForResult();
  if (result !== 'PASS') throw new Error(`webview bridge smoke failed: ${result}`);
  console.log(`WEBVIEW_BRIDGE_ELECTRON43_SMOKE_OK electron=${process.versions.electron} chromium=${process.versions.chrome}`);
}

app.whenReady()
  .then(run)
  .then(() => {
    try { win?.destroy(); } catch {}
    try { server?.close(); } catch {}
    app.quit();
  })
  .catch((error) => {
    console.error(`WEBVIEW_BRIDGE_ELECTRON43_SMOKE_FAIL ${String(error?.message || error)}`);
    try { win?.destroy(); } catch {}
    try { server?.close(); } catch {}
    app.exit(1);
  });

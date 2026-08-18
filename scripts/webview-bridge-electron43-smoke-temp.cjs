'use strict';

const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const path = require('node:path');

const bridgePreload = path.join(__dirname, '..', 'resources', 'bridge-preload.cjs');
const fallbackPrefix = '__GEEK_TRANSLATION_REQUEST__:';
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
          <webview id="bridgeGuest" src="http://127.0.0.1:${port}/guest-bridge" style="width:400px;height:200px"></webview>
          <webview id="consoleGuest" src="http://127.0.0.1:${port}/guest-console" style="width:400px;height:200px"></webview>
          <script>
            window.__bridgeSmokeState = { bridge: false, console: false, error: '' };
            const bridgeGuest = document.getElementById('bridgeGuest');
            const consoleGuest = document.getElementById('consoleGuest');
            function failed(event) {
              window.__bridgeSmokeState.error = 'FAIL_LOAD_' + String(event.errorCode || 'unknown');
            }
            bridgeGuest.addEventListener('ipc-message', (event) => {
              const payload = event.args && event.args[0];
              if (event.channel === 'geek-bridge' && payload && payload.type === 'probe' && payload.value === 'electron43') {
                window.__bridgeSmokeState.bridge = true;
              }
            });
            consoleGuest.addEventListener('console-message', (event) => {
              if (String(event.message || '') === '${fallbackPrefix}probe:token') {
                window.__bridgeSmokeState.console = true;
              }
            });
            bridgeGuest.addEventListener('did-fail-load', failed);
            consoleGuest.addEventListener('did-fail-load', failed);
          <\/script>
        `));
        return;
      }
      if (req.url === '/guest-bridge') {
        res.end(page(`
          <script>
            setTimeout(() => {
              window.postMessage({ __geekBridge: true, payload: { type: 'probe', value: 'electron43' } }, window.location.origin);
            }, 150);
          <\/script>
        `));
        return;
      }
      if (req.url === '/guest-console') {
        res.end(page(`
          <script>
            setTimeout(() => console.log('${fallbackPrefix}probe:token'), 150);
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
    const state = await win.webContents.executeJavaScript('window.__bridgeSmokeState || null', true).catch(() => null);
    if (state?.error) return { ok: false, state };
    if (state?.bridge && state?.console) return { ok: true, state };
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const state = await win.webContents.executeJavaScript('window.__bridgeSmokeState || null', true).catch(() => null);
  return { ok: false, state: state || { bridge: false, console: false, error: 'TIMEOUT' } };
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
    const isConsoleFallback = String(params.src || '').includes('/guest-console');
    if (!isConsoleFallback) webPreferences.preload = bridgePreload;
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
  if (!result.ok) {
    throw new Error(`webview transports failed bridge=${String(result.state?.bridge)} console=${String(result.state?.console)} error=${String(result.state?.error || '')}`);
  }
  console.log(`WEBVIEW_BRIDGE_ELECTRON43_SMOKE_OK electron=${process.versions.electron} chromium=${process.versions.chrome} bridge=ok console=ok`);
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

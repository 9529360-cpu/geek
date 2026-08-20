'use strict';

const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');

const EXTENSION_PATH = path.join(__dirname, '..', 'resources', 'extensions', 'line-3.5.1');
const PARTITION = 'persist:geek-line-translation-probe';
const REQUEST_ID = 'probe_12345678';
const DUMMY_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const MARKER = `__GEEK_TRANSLATION_REQUEST__:${REQUEST_ID}:${DUMMY_TOKEN}`;

let win = null;

function fail(message) {
  throw new Error(message);
}

async function waitForResult(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await win.webContents.executeJavaScript('window.__lineProbeState || null', true).catch(() => null);
    if (state?.error) return state;
    if (state?.guestProbeDone && state?.consoleSeen && (!state.hasSend || state.ipcSeen)) return state;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return await win.webContents.executeJavaScript('window.__lineProbeState || null', true).catch(() => null);
}

async function run() {
  const ses = session.fromPartition(PARTITION, { cache: true });
  const extension = await ses.extensions.loadExtension(EXTENSION_PATH);
  if (!extension?.id) fail('LINE extension did not return an extension id');

  const extensionUrl = `chrome-extension://${extension.id}/index.html`;
  const hostHtml = `<!doctype html><meta charset="utf-8"><body>
    <webview id="lineGuest" partition="${PARTITION}" src="${extensionUrl}" style="width:900px;height:700px"></webview>
    <script>
      window.__lineProbeState = {
        guestProbeDone: false,
        hasElectron: false,
        hasSend: false,
        sendCallSucceeded: false,
        ipcSeen: false,
        ipcChannelMatched: false,
        ipcPayloadObject: false,
        ipcTypePreserved: false,
        ipcIdPreserved: false,
        ipcTokenPreserved: false,
        consoleSeen: false,
        error: ''
      };
      const guest = document.getElementById('lineGuest');
      guest.addEventListener('did-fail-load', event => {
        window.__lineProbeState.error = 'LOAD_FAILED_' + String(event.errorCode || 'unknown');
      });
      guest.addEventListener('ipc-message', event => {
        const payload = event.args && event.args[0];
        const state = window.__lineProbeState;
        state.ipcSeen = true;
        state.ipcChannelMatched = event.channel === 'send2Host';
        state.ipcPayloadObject = !!payload && typeof payload === 'object';
        state.ipcTypePreserved = payload?.type === 'geek-translation-request';
        state.ipcIdPreserved = payload?.id === '${REQUEST_ID}';
        state.ipcTokenPreserved = payload?.token === '${DUMMY_TOKEN}';
      });
      guest.addEventListener('console-message', event => {
        if (String(event.message || '') === '${MARKER}') window.__lineProbeState.consoleSeen = true;
      });
      guest.addEventListener('dom-ready', async () => {
        try {
          const probe = await guest.executeJavaScript(`(() => {
            const hasElectron = !!window.$electron;
            const hasSend = typeof window.$electron?.send2Host === 'function';
            let sendCallSucceeded = false;
            if (hasSend) {
              try {
                window.$electron.send2Host({
                  type: 'geek-translation-request',
                  id: '${REQUEST_ID}',
                  token: '${DUMMY_TOKEN}'
                });
                sendCallSucceeded = true;
              } catch {}
            }
            console.log('${MARKER}');
            return { hasElectron, hasSend, sendCallSucceeded };
          })()`, true);
          Object.assign(window.__lineProbeState, probe || {}, { guestProbeDone: true });
        } catch {
          window.__lineProbeState.error = 'GUEST_PROBE_EXECUTION_FAILED';
        }
      }, { once: true });
    <\/script>
  </body>`;

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

  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (params.src !== extensionUrl || params.partition !== PARTITION) {
      event.preventDefault();
      return;
    }
    delete webPreferences.preload;
    webPreferences.contextIsolation = false;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    params.webpreferences = 'contextIsolation=no,sandbox=true,nativeWindowOpen=yes,spellcheck=no,backgroundThrottling=false';
  });

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(hostHtml)}`);
  const result = await waitForResult();
  if (!result) fail('LINE extension bridge probe returned no state');
  if (result.error) fail(result.error);
  if (!result.guestProbeDone) fail('LINE extension guest probe timed out');
  if (!result.consoleSeen) fail('LINE extension console-message fallback was not observed');
  if (result.hasSend && !result.ipcSeen) fail('LINE $electron.send2Host existed but no ipc-message reached the embedder');

  console.log([
    'LINE_EXTENSION_BRIDGE_PROBE_OK',
    `electron=${process.versions.electron}`,
    `hasElectron=${Boolean(result.hasElectron)}`,
    `hasSend=${Boolean(result.hasSend)}`,
    `sendCallSucceeded=${Boolean(result.sendCallSucceeded)}`,
    `ipcSeen=${Boolean(result.ipcSeen)}`,
    `ipcChannelMatched=${Boolean(result.ipcChannelMatched)}`,
    `ipcPayloadObject=${Boolean(result.ipcPayloadObject)}`,
    `ipcTypePreserved=${Boolean(result.ipcTypePreserved)}`,
    `ipcIdPreserved=${Boolean(result.ipcIdPreserved)}`,
    `ipcTokenPreserved=${Boolean(result.ipcTokenPreserved)}`,
    `consoleSeen=${Boolean(result.consoleSeen)}`,
  ].join(' '));
}

app.whenReady()
  .then(run)
  .then(async () => {
    try { win?.destroy(); } catch {}
    try { await session.fromPartition(PARTITION).clearStorageData(); } catch {}
    app.quit();
  })
  .catch(async error => {
    console.error(`LINE_EXTENSION_BRIDGE_PROBE_FAIL ${String(error?.message || error)}`);
    try { win?.destroy(); } catch {}
    try { await session.fromPartition(PARTITION).clearStorageData(); } catch {}
    app.exit(1);
  });

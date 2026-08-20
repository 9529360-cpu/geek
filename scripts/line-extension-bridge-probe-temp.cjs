'use strict';

const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const EXTENSION_PATH = path.join(__dirname, '..', 'resources', 'extensions', 'line-3.5.1');
const ADAPTER_PATH = path.join(__dirname, '..', 'ui', 'translation-adapters.js');
const SECURITY_PATH = path.join(__dirname, '..', 'ui', 'webview-bridge-security.js');
const PARTITION = 'persist:geek-line-translation-probe';
const DUMMY_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const DUMMY_ACCOUNT_ID = 'probe-account';
const DUMMY_CHAT_ID = 'probe-chat';
const DUMMY_TEXT = 'probe-text';
const DUMMY_RESULT = 'probe-result';
const REQUEST_PREFIX = '__GEEK_TRANSLATION_REQUEST__:';

let win = null;

function fail(message) {
  throw new Error(message);
}

async function waitForResult(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await win.webContents.executeJavaScript('window.__lineProbeState || null', true).catch(() => null);
    if (state?.error) return state;
    if (state?.promiseResolved) return state;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return await win.webContents.executeJavaScript('window.__lineProbeState || null', true).catch(() => null);
}

async function run() {
  const adapterSource = fs.readFileSync(ADAPTER_PATH, 'utf8');
  const securitySource = fs.readFileSync(SECURITY_PATH, 'utf8');
  const ses = session.fromPartition(PARTITION, { cache: true });
  const extension = await ses.extensions.loadExtension(EXTENSION_PATH);
  if (!extension?.id) fail('LINE extension did not return an extension id');

  const extensionUrl = `chrome-extension://${extension.id}/index.html`;
  const hostHtml = `<!doctype html><meta charset="utf-8"><body>
    <webview id="lineGuest" partition="${PARTITION}" src="${extensionUrl}" style="width:900px;height:700px"></webview>
    <script>${securitySource}<\/script>
    <script>
      const ADAPTER_SOURCE = ${JSON.stringify(adapterSource)};
      const DUMMY_TOKEN = ${JSON.stringify(DUMMY_TOKEN)};
      const DUMMY_ACCOUNT_ID = ${JSON.stringify(DUMMY_ACCOUNT_ID)};
      const DUMMY_CHAT_ID = ${JSON.stringify(DUMMY_CHAT_ID)};
      const DUMMY_TEXT = ${JSON.stringify(DUMMY_TEXT)};
      const DUMMY_RESULT = ${JSON.stringify(DUMMY_RESULT)};
      const REQUEST_PREFIX = ${JSON.stringify(REQUEST_PREFIX)};
      window.__lineProbeState = {
        adapterLoaded: false,
        installReady: false,
        hadRequestBeforeInstall: false,
        hasTake: false,
        hasResolve: false,
        requestSeen: false,
        transport: '',
        authorizationOk: false,
        payloadRetrieved: false,
        payloadTokenMatched: false,
        payloadFieldsMatched: false,
        resolveReturned: false,
        promiseResolved: false,
        error: ''
      };
      const guest = document.getElementById('lineGuest');
      let requestHandling = false;

      function setError(code) {
        if (!window.__lineProbeState.error) window.__lineProbeState.error = code;
      }

      async function handleRequest(requestId, suppliedToken, transport) {
        if (requestHandling) return;
        requestHandling = true;
        const state = window.__lineProbeState;
        state.requestSeen = true;
        state.transport = transport;
        try {
          const authorization = window.GeekWebviewBridgeSecurity.authorize({
            expectedToken: DUMMY_TOKEN,
            suppliedToken,
            requestId,
            inflight: 0,
            limit: 8,
          });
          if (!authorization?.ok) { setError('AUTHORIZATION_REJECTED_' + String(authorization?.reason || 'UNKNOWN')); return; }
          state.authorizationOk = true;

          const raw = await guest.executeJavaScript('window.__geekTakeTranslationRequest?.(' + JSON.stringify(requestId) + ') || null', true);
          const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (!payload || typeof payload !== 'object') { setError('PENDING_PAYLOAD_MISSING'); return; }
          state.payloadRetrieved = true;
          if (payload.bridgeToken !== suppliedToken || suppliedToken !== DUMMY_TOKEN) { setError('PENDING_PAYLOAD_TOKEN_MISMATCH'); return; }
          state.payloadTokenMatched = true;
          if (payload.text !== DUMMY_TEXT || payload.source !== 'auto' || payload.target !== 'en' || payload.provider !== 'auto' || payload.route !== 'default' || payload.chatId !== DUMMY_CHAT_ID) {
            setError('PENDING_PAYLOAD_FIELDS_MISMATCH');
            return;
          }
          state.payloadFieldsMatched = true;

          const resolved = await guest.executeJavaScript(
            'window.__geekResolveTranslation?.(' + JSON.stringify(requestId) + ', ' + JSON.stringify({ text: DUMMY_RESULT }) + ', null) === true',
            true
          );
          if (!resolved) { setError('GUEST_RESOLVE_REJECTED'); return; }
          state.resolveReturned = true;

          const deadline = Date.now() + 3000;
          while (Date.now() < deadline) {
            const promiseState = await guest.executeJavaScript('window.__lineProbePromiseState || "pending"', true).catch(() => 'error');
            if (promiseState === 'resolved') { state.promiseResolved = true; return; }
            if (promiseState === 'rejected' || promiseState === 'bad-result' || promiseState === 'error') { setError('GUEST_PROMISE_' + String(promiseState).toUpperCase()); return; }
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          setError('GUEST_PROMISE_DID_NOT_RESOLVE');
        } catch {
          setError('HOST_REQUEST_HANDLER_FAILED');
        }
      }

      guest.addEventListener('did-fail-load', event => {
        setError('LOAD_FAILED_' + String(event.errorCode || 'unknown'));
      });
      guest.addEventListener('console-message', event => {
        const message = String(event.message || '');
        if (!message.startsWith(REQUEST_PREFIX)) return;
        const parts = message.slice(REQUEST_PREFIX.length).split(':');
        handleRequest(parts.shift() || '', parts.shift() || '', 'console');
      });
      guest.addEventListener('ipc-message', event => {
        const message = event.args && event.args[0];
        if (event.channel !== 'send2Host' || !message || message.type !== 'geek-translation-request') return;
        handleRequest(String(message.id || ''), String(message.token || ''), 'ipc');
      });
      guest.addEventListener('dom-ready', async () => {
        try {
          await guest.executeJavaScript(ADAPTER_SOURCE, true);
          window.__lineProbeState.adapterLoaded = true;
          const install = await guest.executeJavaScript(`(() => {
            const hadRequestBeforeInstall = typeof window.__geekTranslationRequest === 'function';
            const installer = window.GeekTranslationAdapters?.line;
            if (typeof installer !== 'function') return { error: 'LINE_ADAPTER_INSTALLER_MISSING' };
            const result = installer({
              accountId: '${DUMMY_ACCOUNT_ID}',
              bridgeToken: '${DUMMY_TOKEN}',
              chats: {},
              global: { message: true, displayTranslation: true, translationMode: 'auto' }
            });
            const hasTake = typeof window.__geekTakeTranslationRequest === 'function';
            const hasResolve = typeof window.__geekResolveTranslation === 'function';
            window.__lineProbePromiseState = 'pending';
            window.__geekTranslationRequest({
              text: '${DUMMY_TEXT}',
              source: 'auto',
              target: 'en',
              provider: 'auto',
              route: 'default',
              chatId: '${DUMMY_CHAT_ID}'
            }).then(value => {
              window.__lineProbePromiseState = value?.text === '${DUMMY_RESULT}' ? 'resolved' : 'bad-result';
            }).catch(() => {
              window.__lineProbePromiseState = 'rejected';
            });
            return { result, hadRequestBeforeInstall, hasTake, hasResolve };
          })()`, true);
          if (install?.error) { setError(install.error); return; }
          Object.assign(window.__lineProbeState, {
            installReady: install?.result === 'LINE_TRANSLATION_READY',
            hadRequestBeforeInstall: Boolean(install?.hadRequestBeforeInstall),
            hasTake: Boolean(install?.hasTake),
            hasResolve: Boolean(install?.hasResolve),
          });
          if (!window.__lineProbeState.installReady) setError('LINE_ADAPTER_NOT_READY');
          else if (!window.__lineProbeState.hasTake) setError('TAKE_TRANSLATION_REQUEST_MISSING');
          else if (!window.__lineProbeState.hasResolve) setError('RESOLVE_TRANSLATION_MISSING');
        } catch {
          setError('ADAPTER_PROBE_EXECUTION_FAILED');
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
  if (!result) fail('LINE adapter round-trip probe returned no state');
  if (result.error) fail(result.error);
  if (!result.adapterLoaded) fail('LINE adapter source was not loaded');
  if (!result.installReady) fail('LINE adapter did not report ready');
  if (result.hadRequestBeforeInstall) fail('LINE page unexpectedly had a Geek translation request bridge before adapter install');
  if (!result.hasTake || !result.hasResolve) fail('LINE adapter did not expose pending request helpers');
  if (!result.requestSeen) fail('LINE adapter translation request was not observed by the embedder');
  if (!result.authorizationOk) fail('LINE adapter translation request did not pass bridge authorization');
  if (!result.payloadRetrieved || !result.payloadTokenMatched || !result.payloadFieldsMatched) fail('LINE adapter pending payload validation failed');
  if (!result.resolveReturned || !result.promiseResolved) fail('LINE adapter translation result did not round-trip to the guest promise');

  console.log(`LINE_ADAPTER_ROUNDTRIP_OK transport=${result.transport || 'unknown'}`);
}

app.whenReady()
  .then(run)
  .then(async () => {
    try { win?.destroy(); } catch {}
    try { await session.fromPartition(PARTITION).clearStorageData(); } catch {}
    app.quit();
  })
  .catch(async error => {
    console.error(`LINE_ADAPTER_ROUNDTRIP_FAIL ${String(error?.message || error)}`);
    try { win?.destroy(); } catch {}
    try { await session.fromPartition(PARTITION).clearStorageData(); } catch {}
    app.exit(1);
  });

'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  classifyConsoleMessage,
  normalizeProbe,
  currentNavigationIsMainFrame,
  consoleMessageFromArgs,
  installWhatsAppStartupDiagnostics,
} = require('../src/whatsapp-startup-diagnostics.cjs');
const { policyForAccount } = require('../src/webview-navigation-boundary.cjs');

assert.equal(classifyConsoleMessage('Module ChatStore was not found'), 'MODULE_NOT_FOUND');
assert.equal(classifyConsoleMessage("Cannot read properties of undefined (reading 'on')"), 'UNDEFINED_ON');
assert.equal(classifyConsoleMessage('Loading chunk 42 failed'), 'CHUNK_LOAD_FAILED');
assert.equal(classifyConsoleMessage('ordinary status line'), '');

assert.equal(currentNavigationIsMainFrame({ isMainFrame: true }, false), true);
assert.equal(currentNavigationIsMainFrame({ isMainFrame: false }, true), false);
assert.equal(currentNavigationIsMainFrame({}, false), false);
assert.equal(consoleMessageFromArgs({ message: 'details-message' }, 'legacy'), 'details-message');
assert.equal(consoleMessageFromArgs(2, 'legacy-message'), 'legacy-message');

assert.deepEqual(normalizeProbe({
  readyState: 'complete',
  secureContext: true,
  metaRequirePresent: true,
  metaDefinePresent: true,
  metaModuleCount: 1234,
  wppPresent: true,
  wppInjected: true,
  wppReady: true,
  wppFullReady: false,
  connMainReady: false,
  waPlusPresent: true,
  chatApiPresent: true,
  bridgeReady: true,
  storagePersistApi: true,
  storagePersisted: true,
  serviceWorkerSupported: true,
  serviceWorkerControlled: false,
  serviceWorkerRegistrations: 1,
  indexedDbSupported: true,
  localStorageLength: 12,
}), {
  readyState: 'complete',
  secureContext: true,
  metaRequirePresent: true,
  metaDefinePresent: true,
  metaModuleCount: 1234,
  wppPresent: true,
  wppInjected: true,
  wppReady: true,
  wppFullReady: false,
  connMainReady: false,
  waPlusPresent: true,
  chatApiPresent: true,
  bridgeReady: true,
  storagePersistApi: true,
  storagePersisted: true,
  serviceWorkerSupported: true,
  serviceWorkerControlled: false,
  serviceWorkerRegistrations: 1,
  indexedDbSupported: true,
  localStorageLength: 12,
});

class FakeContents extends EventEmitter {
  constructor({ partition, url }) {
    super();
    this.session = { partition };
    this.url = url;
    this.destroyed = false;
    this.executeCount = 0;
  }
  isDestroyed() { return this.destroyed; }
  getURL() { return this.url; }
  async executeJavaScript(source) {
    this.executeCount += 1;
    assert.match(source, /wppFullReady/);
    return {
      readyState: 'complete',
      secureContext: true,
      metaRequirePresent: true,
      metaDefinePresent: true,
      metaModuleCount: 900,
      wppPresent: true,
      wppInjected: true,
      wppReady: true,
      wppFullReady: false,
      connMainReady: false,
      waPlusPresent: true,
      chatApiPresent: true,
      bridgeReady: true,
      storagePersistApi: true,
      storagePersisted: true,
      serviceWorkerSupported: true,
      serviceWorkerControlled: false,
      serviceWorkerRegistrations: 0,
      indexedDbSupported: true,
      localStorageLength: 3,
    };
  }
}

(async () => {
  const app = new EventEmitter();
  const scheduled = [];
  const logged = [];
  const partition = 'persist:webview-page-WA1';
  const waPolicy = policyForAccount({ id: 'WA1', type: 'whatsapp' }, partition);
  const tgPartition = 'persist:webview-page-TG1';
  const tgPolicy = policyForAccount({ id: 'TG1', type: 'telegram-z' }, tgPartition);

  installWhatsAppStartupDiagnostics({
    app,
    getUserDataDir: () => '/tmp/geek-validation',
    resolvePolicyForPartition: (value) => value === partition ? waPolicy : value === tgPartition ? tgPolicy : null,
    probeDelays: [0],
    createDiagnosticsFn: () => ({ log(event, metadata) { logged.push({ event, metadata }); } }),
    setTimeoutFn(fn) { scheduled.push(fn); return fn; },
    clearTimeoutFn() {},
  });

  const wa = new FakeContents({ partition, url: 'http://127.0.0.1:1843/' });
  app.emit('web-contents-created', {}, wa);

  wa.emit('console-message', {}, { message: 'Module ChatStore was not found user@example.com secret-token' });
  const consoleEntry = logged.find((entry) => entry.event === 'wa-startup-console-error');
  assert.deepEqual(consoleEntry.metadata, {
    origin: 'http://127.0.0.1:1843',
    generation: 0,
    category: 'MODULE_NOT_FOUND',
  }, 'diagnostic console logging must keep only a category, never the original message');
  assert.doesNotMatch(JSON.stringify(logged), /user@example\.com|secret-token/);

  wa.emit('did-finish-load');
  assert.equal(scheduled.length, 1);
  wa.emit('did-start-navigation', { isMainFrame: true, url: 'http://127.0.0.1:1843/' });
  await scheduled.shift()();
  assert.equal(wa.executeCount, 0, 'probe from a stale document generation must not execute');

  wa.emit('did-finish-load');
  assert.equal(scheduled.length, 1);
  await scheduled.shift()();
  assert.equal(wa.executeCount, 1);
  const probeEntry = logged.find((entry) => entry.event === 'wa-startup-probe');
  assert.equal(probeEntry.metadata.wppReady, true);
  assert.equal(probeEntry.metadata.wppFullReady, false);
  assert.equal(probeEntry.metadata.connMainReady, false);
  assert.equal(probeEntry.metadata.storagePersisted, true);

  const tg = new FakeContents({ partition: tgPartition, url: 'https://web.telegram.org/a/' });
  app.emit('web-contents-created', {}, tg);
  tg.emit('console-message', {}, { message: 'Module ChatStore was not found' });
  tg.emit('did-finish-load');
  assert.equal(scheduled.length, 0, 'non-WhatsApp accounts must not be probed');

  const wrongOrigin = new FakeContents({ partition, url: 'https://example.com/' });
  app.emit('web-contents-created', {}, wrongOrigin);
  wrongOrigin.emit('console-message', {}, { message: 'Module ChatStore was not found' });
  wrongOrigin.emit('did-finish-load');
  assert.equal(scheduled.length, 0, 'out-of-policy origin must not be probed');

  const mainEntry = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'main-entry.cjs'), 'utf8');
  assert.match(mainEntry, /runtimeIdentity\.profile === 'validation'[\s\S]*installWhatsAppStartupDiagnostics/,
    'startup trace must stay validation-only');

  console.log('WHATSAPP_STARTUP_DIAGNOSTICS_CONTRACT_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

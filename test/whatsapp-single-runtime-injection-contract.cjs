'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8').replace(/\r\n?/g, '\n');
const start = source.indexOf('  async function injectWppWithRetry(wc, part) {');
const end = source.indexOf('\n  });', start);
assert.ok(start >= 0 && end > start, 'exercise the production injection owner');
const ownerSource = source.slice(start, end).trim();

async function runCase(initialWait) {
  const loaded = [];
  const installed = new Set();
  let waits = initialWait;
  let send;
  const context = {
    path, __dirname: path.join(__dirname, '../src'), wppInjected: installed,
    WPP_CAPABILITY_PICKER_SOURCE: 'capability-picker',
    console: { log() {} }, setTimeout: resolve => queueMicrotask(resolve),
    fs: { async readFile(file) { const bundle = file.includes('waplus-wpp') ? 'legacy' : 'official'; loaded.push(bundle); return bundle; } },
  };
  const wc = { async executeJavaScript(script) {
    if (script === 'official') { send = async params => ({ ok: !!params.msgProtobuf }); return; }
    if (script === 'legacy') {
      // The bundled pre-4.4.2 wrapper reads positional args even for named params.
      const original = send;
      send = async (...args) => { const proto = args[1].id ? args[2] : args[1]; return original(proto); };
      return;
    }
    if (script.includes('const deadline =')) return waits-- <= 0;
    if (script.includes('isInjected === true')) return true;
    if (script.includes('primaryChatReady')) return { primaryChatReady: true, primaryLidGroupReady: true, primaryStoresReady: true, fallbackPresent: loaded.includes('legacy') };
    return true;
  } };
  const inject = vm.runInNewContext('(' + ownerSource + ')', context);
  await inject(wc, 'persist:test-owner');
  await assert.doesNotReject(() => send({ msgProtobuf: { conversation: 'synthetic' } }),
    'a settled modern runtime must retain named-parameter native sending');
  assert.deepEqual(loaded, ['official'], 'do not install a second runtime with shared native-module side effects');
  assert.equal(installed.has('persist:test-owner'), true);
}

(async () => {
  await runCase(0);
  await runCase(1);
  console.log('WHATSAPP_SINGLE_RUNTIME_INJECTION_CONTRACT_OK');
})().catch(error => { console.error(error); process.exitCode = 1; });

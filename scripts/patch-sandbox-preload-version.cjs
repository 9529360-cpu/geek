'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content);
}

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`${label}: anchor missing`);
  if (source.indexOf(needle, first + needle.length) >= 0) throw new Error(`${label}: anchor not unique`);
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

let preload = read('src/preload.cjs');
preload = replaceOnce(
  preload,
  "const APP_VERSION = String(require('../package.json').version || '').trim();\n",
  '',
  'remove sandbox-incompatible package require'
);
preload = replaceOnce(
  preload,
  '    app: Object.freeze({ version: APP_VERSION }),',
  "    app: Object.freeze({ version: () => ipcRenderer.invoke('app:get-version') }),",
  'replace app version bridge'
);
write('src/preload.cjs', preload);

let main = read('src/main.cjs');
const platformAnchor = "  ipcMain.handle('platforms:list', async (event) => {";
main = replaceOnce(
  main,
  platformAnchor,
  "  ipcMain.handle('app:get-version', async (event) => {\n    assertTrustedSender(event);\n    return app.getVersion();\n  });\n  " + platformAnchor.trimStart(),
  'insert app version IPC'
);
write('src/main.cjs', main);

write('ui/version-label.js', `(() => {
  'use strict';

  const label = document.getElementById('nav-version');
  if (!label) return;

  const render = (value) => {
    const version = String(value || '').trim();
    const valid = /^[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version);
    label.textContent = valid ? 'v' + version : 'v—';
  };

  const getVersion = window.api?.app?.version;
  if (typeof getVersion !== 'function') {
    render('');
    return;
  }

  Promise.resolve()
    .then(() => getVersion())
    .then(render)
    .catch(() => render(''));
})();
`);

write('test/ui-runtime-version-contract.cjs', `'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const main = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src', 'preload.cjs'), 'utf8');
const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'ui', 'version-label.js'), 'utf8');

assert.doesNotMatch(preload, /require\\(['\"]\\.\\.?\\//, 'sandboxed preload must not use relative CommonJS require');
assert.doesNotMatch(preload, /require\\(['\"]\\.\\.\\/package\\.json['\"]\\)/, 'sandboxed preload must not read package.json directly');
assert.match(preload, /app: Object\\.freeze\\(\\{ version: \\(\\) => ipcRenderer\\.invoke\\('app:get-version'\\) \\}\\)/, 'preload must expose app version through read-only IPC');
assert.match(main, /ipcMain\\.handle\\('app:get-version',[\\s\\S]*?assertTrustedSender\\(event\\);[\\s\\S]*?return app\\.getVersion\\(\\);[\\s\\S]*?\\}\\);/, 'main process must return app.getVersion() only to trusted renderer');
assert.doesNotMatch(html, /id="nav-version">v1\\.0\\.0</, 'UI must not hard-code v1.0.0');
assert.match(html, /id="nav-version">v—</, 'UI should use a neutral placeholder before runtime version rendering');
assert.match(html, /<script src="version-label\\.js"><\\/script>/, 'UI must load the runtime version label module');

const exposed = {};
const invoked = [];
const contextBridge = {
  exposeInMainWorld(name, value) {
    exposed[name] = value;
  },
};
const ipcRenderer = {
  invoke(channel, ...args) {
    invoked.push([channel, args]);
    if (channel === 'app:get-version') return Promise.resolve(pkg.version);
    if (channel === 'platforms:list') return Promise.resolve([{ type: 'whatsapp', name: 'WhatsApp', short: 'WA' }]);
    return Promise.resolve(null);
  },
  on() {},
};
function sandboxRequire(id) {
  if (id !== 'electron') throw new Error('sandbox require blocked: ' + id);
  return { contextBridge, ipcRenderer };
}
vm.runInNewContext(preload, { require: sandboxRequire, console }, { filename: 'preload.cjs' });
assert.equal(typeof exposed.api?.platforms?.list, 'function', 'sandbox preload must finish and expose platforms.list');
assert.equal(typeof exposed.api?.app?.version, 'function', 'sandbox preload must finish and expose app.version');

async function render(version, reject = false) {
  const label = { textContent: '' };
  const context = {
    window: {
      api: {
        app: {
          version: () => reject ? Promise.reject(new Error('version unavailable')) : Promise.resolve(version),
        },
      },
    },
    document: { getElementById: (id) => id === 'nav-version' ? label : null },
    Promise,
  };
  vm.runInNewContext(script, context, { filename: 'version-label.js' });
  await new Promise((resolve) => setImmediate(resolve));
  return label.textContent;
}

(async () => {
  assert.equal(await exposed.api.app.version(), pkg.version, 'app version bridge must use app:get-version IPC');
  assert.equal(await exposed.api.platforms.list().then((items) => items[0].type), 'whatsapp', 'platforms bridge must remain usable after preload initialization');
  assert.ok(invoked.some(([channel]) => channel === 'app:get-version'), 'app:get-version IPC must be invoked');
  assert.ok(invoked.some(([channel]) => channel === 'platforms:list'), 'platforms:list IPC must remain invokable');
  assert.equal(await render(pkg.version), 'v' + pkg.version, 'UI label must render the runtime app version');
  assert.equal(await render('not-a-version'), 'v—', 'invalid version values must not be rendered as a fake client version');
  assert.equal(await render('', true), 'v—', 'version IPC failure must degrade to the neutral placeholder');
  console.log('UI_RUNTIME_VERSION_CONTRACT_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`);

console.log('PATCH_SANDBOX_PRELOAD_VERSION_OK');

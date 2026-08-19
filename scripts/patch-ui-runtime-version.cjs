'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`${label}: anchor missing`);
  if (source.indexOf(needle, first + needle.length) >= 0) throw new Error(`${label}: anchor not unique`);
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

const preloadPath = path.join(root, 'src', 'preload.cjs');
let preload = fs.readFileSync(preloadPath, 'utf8');
preload = replaceOnce(
  preload,
  "const { contextBridge, ipcRenderer } = require('electron');\n",
  "const { contextBridge, ipcRenderer } = require('electron');\nconst APP_VERSION = String(require('../package.json').version || '').trim();\n",
  'preload app version source'
);
preload = replaceOnce(
  preload,
  "  Object.freeze({\n    accounts: Object.freeze({\n",
  "  Object.freeze({\n    app: Object.freeze({ version: APP_VERSION }),\n    accounts: Object.freeze({\n",
  'preload read-only app version API'
);
fs.writeFileSync(preloadPath, preload);

const indexPath = path.join(root, 'ui', 'index.html');
let index = fs.readFileSync(indexPath, 'utf8');
index = replaceOnce(index, '<div class="nav-logo-sub" id="nav-version">v1.0.0</div>', '<div class="nav-logo-sub" id="nav-version">v—</div>', 'version placeholder');
index = replaceOnce(index, '<script src="log-url.js"></script>\n<script src="app.js"></script>', '<script src="log-url.js"></script>\n<script src="version-label.js"></script>\n<script src="app.js"></script>', 'version label script');
fs.writeFileSync(indexPath, index);

fs.writeFileSync(path.join(root, 'ui', 'version-label.js'), `(() => {\n  'use strict';\n\n  const label = document.getElementById('nav-version');\n  if (!label) return;\n\n  const version = String(window.api?.app?.version || '').trim();\n  const valid = /^[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version);\n  label.textContent = valid ? \\`v\\${version}\\` : 'v—';\n})();\n`);

fs.writeFileSync(path.join(root, 'test', 'ui-runtime-version-contract.cjs'), `'use strict';\nconst assert = require('node:assert/strict');\nconst fs = require('node:fs');\nconst path = require('node:path');\nconst vm = require('node:vm');\n\nconst root = path.resolve(__dirname, '..');\nconst pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));\nconst preload = fs.readFileSync(path.join(root, 'src', 'preload.cjs'), 'utf8');\nconst html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');\nconst script = fs.readFileSync(path.join(root, 'ui', 'version-label.js'), 'utf8');\n\nassert.match(preload, /const APP_VERSION = String\\(require\\('\\.\\.\\/package\\.json'\\)\\.version \\|\\| ''\\)\\.trim\\(\\);/, 'preload must derive the UI version from package.json');\nassert.match(preload, /app: Object\\.freeze\\(\\{ version: APP_VERSION \\}\\)/, 'preload must expose only a read-only app version value');\nassert.doesNotMatch(html, /id="nav-version">v1\\.0\\.0</, 'UI must not hard-code v1.0.0');\nassert.match(html, /id="nav-version">v—</, 'UI should use a neutral placeholder before preload version rendering');\nassert.match(html, /<script src="version-label\\.js"><\\/script>/, 'UI must load the runtime version label module');\n\nfunction render(version) {\n  const label = { textContent: '' };\n  const context = {\n    window: { api: { app: { version } } },\n    document: { getElementById: (id) => id === 'nav-version' ? label : null },\n  };\n  vm.runInNewContext(script, context, { filename: 'version-label.js' });\n  return label.textContent;\n}\n\nassert.equal(render(pkg.version), \\`v\\${pkg.version}\\`, 'UI label must follow package.json version through preload');\nassert.equal(render('not-a-version'), 'v—', 'invalid version values must not be rendered as a fake client version');\n\nconsole.log('UI_RUNTIME_VERSION_CONTRACT_OK');\n`);

console.log('UI_RUNTIME_VERSION_PATCH_OK');

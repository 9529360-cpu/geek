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

const versionLabelSource = [
  '(() => {',
  "  'use strict';",
  '',
  "  const label = document.getElementById('nav-version');",
  '  if (!label) return;',
  '',
  "  const version = String(window.api?.app?.version || '').trim();",
  '  const valid = /^[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version);',
  "  label.textContent = valid ? 'v' + version : 'v—';",
  '})();',
  '',
].join('\n');
fs.writeFileSync(path.join(root, 'ui', 'version-label.js'), versionLabelSource);

const contractSource = [
  "'use strict';",
  "const assert = require('node:assert/strict');",
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  "const vm = require('node:vm');",
  '',
  "const root = path.resolve(__dirname, '..');",
  "const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));",
  "const preload = fs.readFileSync(path.join(root, 'src', 'preload.cjs'), 'utf8');",
  "const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');",
  "const script = fs.readFileSync(path.join(root, 'ui', 'version-label.js'), 'utf8');",
  '',
  "assert.match(preload, /const APP_VERSION = String\\(require\\('\\.\\.\\/package\\.json'\\)\\.version \\|\\| ''\\)\\.trim\\(\\);/, 'preload must derive the UI version from package.json');",
  "assert.match(preload, /app: Object\\.freeze\\(\\{ version: APP_VERSION \\}\\)/, 'preload must expose only a read-only app version value');",
  "assert.doesNotMatch(html, /id=\"nav-version\">v1\\.0\\.0</, 'UI must not hard-code v1.0.0');",
  "assert.match(html, /id=\"nav-version\">v—</, 'UI should use a neutral placeholder before preload version rendering');",
  "assert.match(html, /<script src=\"version-label\\.js\"><\\/script>/, 'UI must load the runtime version label module');",
  '',
  'function render(version) {',
  "  const label = { textContent: '' };",
  '  const context = {',
  '    window: { api: { app: { version } } },',
  "    document: { getElementById: (id) => id === 'nav-version' ? label : null },",
  '  };',
  "  vm.runInNewContext(script, context, { filename: 'version-label.js' });",
  '  return label.textContent;',
  '}',
  '',
  "assert.equal(render(pkg.version), 'v' + pkg.version, 'UI label must follow package.json version through preload');",
  "assert.equal(render('not-a-version'), 'v—', 'invalid version values must not be rendered as a fake client version');",
  '',
  "console.log('UI_RUNTIME_VERSION_CONTRACT_OK');",
  '',
].join('\n');
fs.writeFileSync(path.join(root, 'test', 'ui-runtime-version-contract.cjs'), contractSource);

console.log('UI_RUNTIME_VERSION_PATCH_OK');

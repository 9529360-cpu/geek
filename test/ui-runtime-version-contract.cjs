'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const preload = fs.readFileSync(path.join(root, 'src', 'preload.cjs'), 'utf8');
const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'ui', 'version-label.js'), 'utf8');

assert.match(preload, /const APP_VERSION = String\(require\('\.\.\/package\.json'\)\.version \|\| ''\)\.trim\(\);/, 'preload must derive the UI version from package.json');
assert.match(preload, /app: Object\.freeze\(\{ version: APP_VERSION \}\)/, 'preload must expose only a read-only app version value');
assert.doesNotMatch(html, /id="nav-version">v1\.0\.0</, 'UI must not hard-code v1.0.0');
assert.match(html, /id="nav-version">v—</, 'UI should use a neutral placeholder before preload version rendering');
assert.match(html, /<script src="version-label\.js"><\/script>/, 'UI must load the runtime version label module');

function render(version) {
  const label = { textContent: '' };
  const context = {
    window: { api: { app: { version } } },
    document: { getElementById: (id) => id === 'nav-version' ? label : null },
  };
  vm.runInNewContext(script, context, { filename: 'version-label.js' });
  return label.textContent;
}

assert.equal(render(pkg.version), 'v' + pkg.version, 'UI label must follow package.json version through preload');
assert.equal(render('not-a-version'), 'v—', 'invalid version values must not be rendered as a fake client version');

console.log('UI_RUNTIME_VERSION_CONTRACT_OK');

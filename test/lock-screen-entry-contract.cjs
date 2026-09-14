'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ui', 'lock-screen-entry.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'ui', 'version-label.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');

assert.match(app, /async function lockScreen\(\)[\s\S]*window\.api\.config\.get\(\)/, 'app.js must remain the authoritative lock owner');
assert.match(app, /if \(!cfg\.lockPassword\)/, 'app.js must retain its password-presence fallback check');
assert.match(app, /alert\('请先在 设置 → 锁屏密码 设置密码'\)/, 'legacy native warning must remain only as compatibility fallback');
assert.match(app, /document\.getElementById\('btn-lock'\)\.onclick = lockScreen/, 'existing lock entry owner must remain wired');
assert.match(html, /id="settings-status"[^>]*aria-live="polite"/, 'settings must retain its canonical live status surface');
assert.match(html, /id="cfg-lockPassword"/, 'settings must retain its canonical lock password field');
assert.match(bootstrap, /lock-screen-entry\.js/, 'shell bootstrap must load lock-screen entry preflight');

assert.match(source, /addEventListener\('click',[\s\S]*true\)/, 'preflight must run in capture before the legacy onclick owner');
assert.match(source, /event\.preventDefault\(\)/, 'preflight must stop the first click while reading config');
assert.match(source, /event\.stopImmediatePropagation\(\)/, 'missing-password canonical path must not reach the native alert fallback');
assert.match(source, /window\.api\.config\.get\(\)/, 'preflight may only read the existing config authority');
assert.match(source, /if \(cfg\?\.lockPassword\) replayAuthoritativeLock\(button\)/, 'configured locks must return to the authoritative app.js owner');
assert.match(source, /catch \(_\) \{[\s\S]*replayAuthoritativeLock\(button\)/, 'preflight read failures must fall back to app.js rather than invent a new failure mode');
assert.match(source, /getElementById\(SETTINGS_BUTTON_ID\)/, 'missing password must route through the existing Settings entry control');
assert.match(source, /status\.textContent = HINT/, 'missing password must use the existing Settings status surface');
assert.match(source, /status\.setAttribute\('role', 'status'\)/, 'settings hint must expose status semantics');
assert.match(source, /field\.setAttribute\('aria-describedby', STATUS_ID\)/, 'password field must be associated with its setup guidance');
assert.match(source, /field\.focus\(\{ preventScroll: true \}\)/, 'security route must focus the actionable password field');
assert.match(source, /scrollIntoView/, 'security settings must be brought into view');
assert.match(source, /lockPasswordHint/, 'typing a password must clear only the route-owned hint');
assert.doesNotMatch(source, /config\.set|lockPassword\s*=|window\.alert|\balert\s*\(/, 'entry preflight must not own password mutation or native messaging');

console.log('LOCK_SCREEN_ENTRY_CONTRACT_OK');

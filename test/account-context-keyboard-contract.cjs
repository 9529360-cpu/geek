'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ui', 'account-context-accessibility.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'ui', 'account-context-accessibility.css'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'ui', 'version-label.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');

assert.match(app, /item\.addEventListener\('contextmenu'/, 'app.js must remain the account context action owner');
assert.match(app, /ctxMenu\.dataset\.accountId\s*=\s*account\.id/, 'context action owner must stay bound to the invoked account');
assert.match(bootstrap, /account-context-accessibility\.css/, 'shell bootstrap must load account context focus styles');
assert.match(bootstrap, /account-context-accessibility\.js/, 'shell bootstrap must load account context accessibility owner');
assert.match(source, /shell-account-menu-button/, 'account rows must expose a discoverable more-actions button');
assert.match(source, /MouseEvent\('contextmenu'/, 'keyboard and more-button activation must reuse the existing contextmenu path');
assert.match(source, /event\.key === 'ContextMenu'/, 'dedicated ContextMenu key must be supported');
assert.match(source, /event\.shiftKey && event\.key === 'F10'/, 'Shift+F10 desktop context-menu convention must be supported');
assert.match(source, /role', 'menu'/, 'context surface must expose menu semantics');
assert.match(source, /role', 'menuitem'/, 'context actions must expose menuitem semantics');
assert.match(source, /aria-haspopup/, 'more-actions button must announce its popup');
assert.match(source, /aria-expanded/, 'more-actions button must expose open state');
assert.match(source, /ArrowUp/);
assert.match(source, /ArrowDown/);
assert.match(source, /Home/);
assert.match(source, /End/);
assert.match(source, /event\.key === 'Escape'/, 'Escape must close the account menu');
assert.match(source, /target\.click\(\)/, 'menu activation must reuse the existing click action owner');
assert.match(source, /dialogReturn/, 'dialog close must restore the invoking account control');
assert.match(source, /expectRefreshReturn/, 'refresh focus intent must be bounded rather than stored forever');
assert.match(source, /setTimeout\([\s\S]*?3000\)/, 'refresh focus intent must expire after a bounded recovery window');
assert.match(source, /String\(contextMenu\.dataset\.accountId \|\| ''\) !== menuReturn\.accountId/, 'mixed mouse/keyboard invocation must retire stale menu focus ownership');
assert.doesNotMatch(source, /refreshAccountInstance|showAccountSettingsDialog|showProxyDialog|removeAccount|window\.api/, 'accessibility owner must not duplicate account business mutations');
assert.match(styles, /shell-account-menu-button:focus-visible/, 'more-actions keyboard focus must be visible');
assert.match(styles, /ctx-item\[role='menuitem'\]:focus-visible/, 'menuitem keyboard focus must be visible');
assert.match(styles, /side-nav\.collapsed \.shell-account-menu-button \{ display: none; \}/, 'collapsed sidebar must not be widened by the more-actions control');

console.log('ACCOUNT_CONTEXT_KEYBOARD_CONTRACT_OK');

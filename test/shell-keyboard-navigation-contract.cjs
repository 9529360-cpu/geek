'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ui', 'shell-accessibility.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'ui', 'shell-accessibility.css'), 'utf8');
const versionLabel = fs.readFileSync(path.join(root, 'ui', 'version-label.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');

assert.match(versionLabel, /shell-accessibility\.css/, 'shell bootstrap must load keyboard focus styles');
assert.match(versionLabel, /shell-accessibility\.js/, 'shell bootstrap must load the accessibility owner');
assert.match(source, /role', 'toolbar'/, 'platform switcher must expose toolbar semantics');
assert.match(source, /role', 'button'/, 'dynamic clickable divs must expose button semantics');
assert.match(source, /aria-pressed/, 'active platform must expose selected state');
assert.match(source, /aria-current/, 'active account must expose current state');
assert.match(source, /tabindex/, 'shell controls must use explicit roving tabindex');
assert.match(source, /document\.activeElement/, 'rerenders must preserve the currently roved keyboard focus');
assert.match(source, /ArrowLeft/);
assert.match(source, /ArrowRight/);
assert.match(source, /ArrowUp/);
assert.match(source, /ArrowDown/);
assert.match(source, /Home/);
assert.match(source, /End/);
assert.match(source, /event\.key === 'Enter' \|\| event\.key === ' '/, 'Enter and Space must activate the existing click path');
assert.match(source, /target\.click\(\)/, 'keyboard activation must reuse existing click ownership');
assert.match(source, /MutationObserver/, 'dynamic app.js rerenders must be redecorated');

assert.match(app, /sideNav\.classList\.toggle\('collapsed'\)/, 'app.js must remain the sole collapse-state action owner');
assert.match(source, /aria-controls', sideNav\.id \|\| 'side-nav'/, 'collapse button must identify the sidebar it controls');
assert.match(source, /aria-expanded', collapsed \? 'false' : 'true'/, 'collapse button must announce the real sidebar state');
assert.match(source, /collapsed \? '展开账号侧栏' : '收起账号侧栏'/, 'collapse action name must describe the next available action');
assert.match(source, /ACCOUNT_IDENTITY_CLASS = 'shell-account-identity'/, 'collapsed accounts must receive a dedicated visual identity decoration');
assert.match(source, /trailingNumber/, 'numbered account names must remain visually distinguishable when collapsed');
assert.match(source, /tokens\.length >= 2/, 'multi-word account names must receive meaningful compact initials');
assert.match(source, /badge\.setAttribute\('aria-hidden', 'true'\)/, 'visual identity must not duplicate the full accessible account name');
assert.match(source, /if \(badge\.textContent !== next\) badge\.textContent = next/, 'dynamic decoration must remain mutation-idempotent');
assert.match(source, /if \(collapsed && name\) setAttrIfChanged\(main, 'title', name\)/, 'collapsed accounts must expose the full name on hover');
assert.match(source, /observer\.observe\(sideNav, \{ attributes: true, attributeFilter: \['class'\] \}\)/, 'shell decoration must follow collapse state changes without owning them');
assert.doesNotMatch(source, /classList\.toggle\('collapsed'\)|localStorage|config\.set/, 'accessibility owner must not become a second collapse-state owner');
assert.doesNotMatch(source, /switchAccount|switchPlatform|window\.api/, 'accessibility owner must not duplicate account/platform business state');

assert.match(styles, /:focus-visible/, 'keyboard focus must be visibly styled');
assert.match(styles, /\.shell-account-identity \{[\s\S]*display: none/, 'compact account identity must stay hidden while the sidebar is expanded');
assert.match(styles, /\.side-nav\.collapsed \.shell-account-identity/, 'compact account identity must become visible only in collapsed mode');
assert.match(styles, /\.side-nav\.collapsed \.nav-account\.active \.shell-account-identity/, 'active account identity must remain visually distinct');
assert.match(styles, /\.nav-collapse:focus-visible/, 'sidebar disclosure button must expose visible keyboard focus');
assert.match(styles, /prefers-reduced-motion:\s*reduce/, 'shell motion must respect reduced-motion preferences');
assert.doesNotMatch(source + versionLabel, /globalShortcut|before-input-event/, 'renderer accessibility must stay local to the shell');

console.log('SHELL_KEYBOARD_NAVIGATION_CONTRACT_OK');

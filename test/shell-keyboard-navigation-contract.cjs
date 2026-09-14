'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ui', 'shell-accessibility.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'ui', 'shell-accessibility.css'), 'utf8');
const versionLabel = fs.readFileSync(path.join(root, 'ui', 'version-label.js'), 'utf8');

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
assert.doesNotMatch(source, /switchAccount|switchPlatform|window\.api/, 'accessibility owner must not duplicate account/platform business state');
assert.match(styles, /:focus-visible/, 'keyboard focus must be visibly styled');
assert.match(styles, /prefers-reduced-motion:\s*reduce/, 'shell motion must respect reduced-motion preferences');
assert.doesNotMatch(source + versionLabel, /globalShortcut|before-input-event/, 'renderer accessibility must stay local to the shell');

console.log('SHELL_KEYBOARD_NAVIGATION_CONTRACT_OK');

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ui', 'lock-screen-accessibility.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'ui', 'lock-screen-accessibility.css'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'ui', 'version-label.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');

assert.match(bootstrap, /lock-screen-accessibility\.css/, 'shell bootstrap must load lock focus/error styles');
assert.match(bootstrap, /lock-screen-accessibility\.js/, 'shell bootstrap must load the lock modal owner');

assert.match(source, /dialog\.setAttribute\('role', 'dialog'\)/, 'lock surface must expose dialog semantics');
assert.match(source, /dialog\.setAttribute\('aria-modal', 'true'\)/, 'lock surface must expose modal semantics');
assert.match(source, /aria-labelledby/, 'lock dialog must have an accessible visible title');
assert.match(source, /aria-describedby/, 'lock dialog must expose its instruction text');
assert.match(source, /app\.inert = true/, 'background application must become physically inert while locked');
assert.match(source, /app\.inert = false/, 'background application must become interactive again after unlock');
assert.match(source, /event\.key === 'Escape'/, 'Escape must be explicitly handled on the lock screen');
assert.match(source, /event\.key !== 'Tab'/, 'lock screen must own Tab focus movement');
assert.match(source, /event\.shiftKey/, 'lock screen must support reverse focus cycling');
assert.match(source, /document\.addEventListener\('focusin'/, 'focus attempts outside the active lock must be redirected');
assert.match(source, /returnFocus/, 'unlock must restore the pre-lock point of regard');

assert.match(source, /error\.setAttribute\('role', 'status'\)/, 'wrong-password feedback must expose status semantics');
assert.match(source, /error\.setAttribute\('aria-live', 'polite'\)/, 'wrong-password feedback must be announced non-destructively');
assert.match(source, /input\.setAttribute\('aria-invalid'/, 'password input must expose validation state');
assert.match(source, /input\.setAttribute\('aria-errormessage', 'lock-error'\)/, 'password input must reference the visible error message');
assert.doesNotMatch(source, /window\.api|config\.get|lockPassword\s*===|unlockScreen|lockScreen\(/, 'accessibility owner must not duplicate lock credential or unlock authority');

assert.match(styles, /#lock-password:focus-visible/, 'password focus must remain visibly identifiable');
assert.match(styles, /#lock-unlock:focus-visible/, 'unlock action focus must remain visibly identifiable');
assert.match(styles, /aria-invalid='true'/, 'invalid password state must have a visual affordance');
assert.match(styles, /prefers-reduced-motion:\s*reduce/, 'lock surface must respect reduced-motion preference');

assert.match(app, /lockPasswordEl\.value === \(cfg\.lockPassword \|\| ''\)/, 'app.js must remain the credential comparison owner');
assert.match(app, /document\.getElementById\('lock-unlock'\)\.onclick = unlockScreen/, 'app.js must remain the unlock action owner');

console.log('LOCK_SCREEN_ACCESSIBILITY_CONTRACT_OK');

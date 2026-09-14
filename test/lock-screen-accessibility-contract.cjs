'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ui', 'lock-screen-accessibility.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'ui', 'lock-screen-accessibility.css'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'ui', 'version-label.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');

assert.match(app, /async function lockScreen\(\)[\s\S]*window\.api\.config\.get\(\)/, 'app.js must remain the lock-state/password owner');
assert.match(app, /async function unlockScreen\(\)[\s\S]*lockPasswordEl\.value === \(cfg\.lockPassword \|\| ''\)/, 'password comparison must remain in app.js');
assert.match(app, /lockOverlay\.classList\.add\('hidden'\)/, 'app.js must remain the unlock visibility owner');
assert.match(bootstrap, /lock-screen-accessibility\.css/, 'shell bootstrap must load lock-screen focus styles');
assert.match(bootstrap, /lock-screen-accessibility\.js/, 'shell bootstrap must load lock-screen accessibility owner');

assert.match(source, /setAttribute\('role', 'dialog'\)/, 'lock screen must expose dialog semantics');
assert.match(source, /setAttribute\('aria-modal', 'true'\)/, 'lock screen must announce itself as modal');
assert.match(source, /aria-labelledby/, 'lock screen must use its visible title as accessible name');
assert.match(source, /aria-describedby/, 'lock screen must expose its unlock guidance and error description');
assert.match(source, /setAttribute\('role', 'alert'\)/, 'invalid password feedback must be announced');
assert.match(source, /aria-live', 'assertive'/, 'password errors must be announced immediately');

assert.match(source, /node\.inert = true/, 'background content must become natively inert');
assert.match(source, /inertState\.set\(node, !!node\.inert\)/, 'pre-existing inert state must be preserved');
assert.match(source, /node\.inert = wasInert/, 'unlock must restore each background node to its previous inert state');
assert.match(source, /MutationObserver\(\(records\)/, 'body insertions during lock must remain inert');
assert.match(source, /record\.addedNodes/, 'new background surfaces must be covered by the lock');

assert.match(source, /event\.key === 'Escape'/, 'Escape must be explicitly handled');
assert.match(source, /event\.key !== 'Tab'/, 'lock screen must own Tab focus containment');
assert.match(source, /event\.shiftKey/, 'reverse Tab cycling must be supported');
assert.match(source, /document\.addEventListener\('focusin'/, 'programmatic focus escape must be recovered');
assert.match(source, /pendingReturnFocus/, 'invoking focus must be captured before app.js opens the lock');
assert.match(source, /restoreFocus/, 'unlock must restore a logical focus target');
assert.match(source, /requestAnimationFrame/, 'focus return must happen after inert state is restored');
assert.doesNotMatch(source, /window\.api|config\.get|config\.set|lockPassword\s*[=!]/, 'accessibility owner must never own password/config business logic');

assert.match(styles, /#lock-password:focus-visible/, 'password keyboard focus must be visible');
assert.match(styles, /#lock-unlock:focus-visible/, 'unlock-button keyboard focus must be visible');
assert.match(styles, /prefers-reduced-motion:\s*reduce/, 'lock-screen polish must respect reduced motion');

console.log('LOCK_SCREEN_ACCESSIBILITY_CONTRACT_OK');

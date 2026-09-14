'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'ui', 'settings-controller.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'ui', 'settings-controller.css'), 'utf8');

assert.match(html, /id="settings-overlay"[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"/, 'global Settings must retain modal dialog semantics');
assert.match(controller, /FOCUSABLE_SELECTOR/, 'Settings owner must define one focusable-control boundary');
assert.match(controller, /function activateModalBoundary\(/, 'Settings owner must activate a physical modal boundary');
assert.match(controller, /node\.inert = true/, 'background surfaces must become natively inert while Settings is open');
assert.match(controller, /modalInertState\.set\(node, !!node\.inert\)/, 'pre-existing inert state must be preserved before takeover');
assert.match(controller, /node\.inert = wasInert/, 'closing Settings must restore each prior inert state');
assert.match(controller, /node\.id !== 'lock-overlay'/, 'Settings must never inert the security lock overlay');
assert.match(controller, /new MutationObserver\(/, 'body surfaces added while Settings is open must inherit the modal boundary');
assert.match(controller, /function trapTab\(/, 'Settings must contain Tab and Shift+Tab inside the dialog');
assert.match(controller, /event\.shiftKey && current <= 0/, 'Shift+Tab from the first Settings control must wrap to the last');
assert.match(controller, /current < 0 \|\| current === controls\.length - 1/, 'Tab from outside or the last control must wrap to the first');
assert.match(controller, /document\.addEventListener\('focusin', keepFocusInside, true\)/, 'programmatic stray focus must be redirected into Settings');
assert.match(controller, /lockOverlayVisible\(\) && lock\?\.contains\(event\.target\)/, 'lock focus must be allowed to supersede Settings');
assert.match(controller, /settingsOverlay\(\)\?\.classList\.remove\('hidden'\);[\s\S]*?activateModalBoundary\(\);[\s\S]*?focusIntoSettings\(\)/, 'opening order must expose Settings, then make the background inert, then focus the dialog');
assert.match(controller, /settingsOverlay\(\)\?\.classList\.add\('hidden'\);[\s\S]*?releaseModalBoundary\(\);[\s\S]*?restoreFocus\(\)/, 'closing order must hide Settings, release background, then restore focus');
assert.doesNotMatch(controller, /window\.api|accounts\.update|config\.set/, 'Settings UX controller must keep using injected business dependencies rather than duplicating API ownership');
assert.match(css, /:focus-visible\{outline:2px solid var\(--accent\)/, 'Settings keyboard focus must remain visibly distinguishable');

console.log('SETTINGS_MODAL_ACCESSIBILITY_CONTRACT_OK');

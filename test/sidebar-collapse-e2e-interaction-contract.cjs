'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'e2e', 'specs', 'sidebar-collapse.e2e.cjs'), 'utf8');

assert.match(source, /const WEBDRIVER_ENTER = '\\uE007';/, 'sidebar E2E must use the canonical WebDriver Enter key');
assert.match(source, /browser\.getActiveElement\(\)/, 'sidebar E2E must send activation through the focused WebDriver element');
assert.match(source, /browser\.elementSendKeys\(elementId, WEBDRIVER_ENTER\)/, 'sidebar E2E must activate through keyboard input');
assert.match(source, /document\.querySelector\(targetSelector\)\?\.focus\(\{ preventScroll: true \}\)/, 'sidebar E2E must focus the canonical shell control before keyboard activation');
assert.doesNotMatch(source, /\.click\(\)/, 'sidebar E2E must not reintroduce geometry-sensitive pointer clicks');
assert.doesNotMatch(source, /waitForClickable/, 'waiting for pointer clickability does not close the transition/re-render geometry race');

console.log('SIDEBAR_COLLAPSE_E2E_INTERACTION_CONTRACT_OK');

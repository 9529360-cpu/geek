'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'ui', 'broadcast-audience-ux.js'), 'utf8');

assert.doesNotMatch(source, /new\s+MutationObserver\s*\(/, 'audience UX must not install a long-lived MutationObserver');
assert.doesNotMatch(source, /observe\s*\([^)]*broadcast-overlay[\s\S]*subtree\s*:\s*true/, 'audience UX must not watch the whole broadcast overlay subtree');
assert.match(source, /node\.textContent\s*!==\s*text/, 'text writes must be idempotent');
assert.match(source, /legacyList\.childNodes\.length/, 'legacy schedule cleanup must avoid no-op child mutations');
assert.match(source, /function\s+apply\s*\(/, 'one-shot audience UX application remains available');

console.log('broadcast audience UX contract: ok');

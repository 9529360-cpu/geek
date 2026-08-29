'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ui', 'broadcast-recipient-tags.js'), 'utf8');

// DEFECT BRT-20260829-PROMPT: Electron renderer does not support browser prompt().
// The user-facing broadcast tag flow must collect the name with in-app DOM UI,
// then invoke the legacy state owner under a bounded synchronous prompt shim.
assert.match(source, /function askTagName\(/, 'recipient tag flow must provide an in-app name dialog');
assert.match(source, /document\.createElement\('input'\)/, 'name dialog must use a normal renderer input control');
assert.match(source, /await askTagName\(/, 'save must await the in-app name dialog before invoking the state owner');
assert.match(source, /const originalPrompt = window\.prompt/, 'owner compatibility shim must preserve the original prompt function');
assert.match(source, /window\.prompt = \(\) => name/, 'owner must receive the already-collected name synchronously');
assert.match(source, /window\.prompt = originalPrompt/, 'prompt shim must always be restored');

const saveStart = source.indexOf('async function saveCurrent');
const saveEnd = source.indexOf('function observeOwner', saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart, 'saveCurrent must remain a bounded function');
const saveBlock = source.slice(saveStart, saveEnd);
assert.doesNotMatch(saveBlock, /window\.prompt\?\.|\bprompt\(/, 'user-facing save path must never invoke native prompt directly');
assert.match(saveBlock, /invokeOwnerHandler\(controls\.ownerSave\)/, 'existing app.js state owner must still commit savedLists exactly once');
assert.match(saveBlock, /verifyDurableCount\(accountId, after, doc\)/, 'save must still verify account-scoped persistence');

console.log('BROADCAST_ELECTRON_PROMPT_REGRESSION_OK');

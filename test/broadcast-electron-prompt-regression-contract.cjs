'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const closure = fs.readFileSync(path.join(root, 'ui', 'broadcast-product-closure.js'), 'utf8');
const recipientTags = fs.readFileSync(path.join(root, 'ui', 'broadcast-recipient-tags.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');

// DEFECT BRT-20260829-PROMPT
// Real Electron validation produced: "保存标签失败:prompt() is not supported."
// The visible broadcast tag flow must collect the name in normal renderer DOM,
// then provide that already-collected value synchronously only while app.js owns
// broadcastSelected/savedLists. Native prompt must never be reached by this path.
assert.match(closure, /id = 'broadcast-recipient-tag-name'/, 'visible tag workflow must render an inline tag-name input');
assert.match(closure, /createElement\('input'\)/, 'tag naming must use a normal renderer input');
assert.match(closure, /placeholder = '标签名称'/, 'the input must make the required action obvious');
assert.match(closure, /const owner = save\.onclick/, 'the compatibility layer must preserve the already-installed recipient-tag owner');
assert.match(closure, /const originalPrompt = window\.prompt/, 'the shim must preserve Electron prompt before invoking app.js owner');
assert.match(closure, /window\.prompt = \(\) => name/, 'app.js owner must receive only the already-collected name');
assert.match(closure, /owner\.call\(save\)/, 'the existing recipient-tag save path must run exactly once');
assert.match(closure, /window\.prompt = originalPrompt/, 'the shim must always restore the global after the synchronous owner call');
assert.doesNotMatch(closure, /window\.prompt\?\(/, 'the compatibility layer must never call native Electron prompt');
assert.doesNotMatch(closure, /persistRecipientPreset|accountData\.set\(accountId, 'savedLists'/, 'product closure must no longer be a second recipient-preset persistence owner');
assert.doesNotMatch(closure, /closest\?\.\('#bc-save-list'\)/, 'product closure must not capture the hidden legacy save button');

assert.match(recipientTags, /invokeOwnerHandler\(controls\.ownerSave\)/, 'recipient-tags must continue delegating to the app.js state owner once');
assert.match(recipientTags, /verifyDurableCount\(accountId, after, doc\)/, 'recipient-tags must still verify account-scoped durability');
assert.match(app, /const name = prompt\('保存为（列表名称）：'/, 'legacy app.js owner may retain prompt internally while the visible Electron path safely supplies its value');
assert.match(app, /savedLists\.push\(\{ name, ids: \[\.\.\.broadcastSelected\] \}\)/, 'app.js remains the single private owner of selected-recipient persistence');

console.log('BROADCAST_ELECTRON_PROMPT_REGRESSION_OK');

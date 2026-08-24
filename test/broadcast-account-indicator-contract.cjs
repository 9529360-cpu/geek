'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indicatorPath = path.join(__dirname, '../ui/broadcast-account-indicator.js');
const source = fs.readFileSync(indicatorPath, 'utf8');
const api = require(indicatorPath);

assert.equal(api.labelFor({ state: 'running' }), '群发中');
assert.equal(api.labelFor({ state: 'completed', fail: 0 }), '已完成');
assert.equal(api.labelFor({ state: 'completed', fail: 1 }), '有失败');
assert.equal(typeof api.isAccountStructureMutation, 'function');

// Behavioral check: idempotent writes must not manufacture new mutations when the
// requested presentation value is already present.
let textWrites = 0;
const textNode = {
  _text: '群发中',
  get textContent() { return this._text; },
  set textContent(value) { textWrites += 1; this._text = value; },
};
api.setTextIfChanged(textNode, '群发中');
assert.equal(textWrites, 0, 'same badge text must not be rewritten');
api.setTextIfChanged(textNode, '已暂停');
assert.equal(textWrites, 1, 'changed badge text must be written exactly once');

let attrWrites = 0;
const attrs = new Map([['title', '群发中']]);
const attrNode = {
  getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
  setAttribute(name, value) { attrWrites += 1; attrs.set(name, value); },
};
api.setAttrIfChanged(attrNode, 'title', '群发中');
assert.equal(attrWrites, 0, 'same badge attribute must not be rewritten');
api.setAttrIfChanged(attrNode, 'title', '群发中 · 1/2');
assert.equal(attrWrites, 1, 'changed badge attribute must be written exactly once');

function elementWith(classes = [], nestedAccount = false) {
  const set = new Set(classes);
  return {
    nodeType: 1,
    classList: { contains: value => set.has(value) },
    querySelector: selector => nestedAccount && selector === '.nav-account' ? {} : null,
  };
}

const badge = elementWith(['bc-account-job-state']);
const account = elementWith(['nav-account']);
const wrapper = elementWith([], true);
const textMutationNode = { nodeType: 3 };

assert.equal(api.isAccountStructureMutation({ type: 'attributes', addedNodes: [], removedNodes: [] }), false, 'attribute mutations are not account structure changes');
assert.equal(api.isAccountStructureMutation({ type: 'childList', addedNodes: [badge], removedNodes: [] }), false, 'adding the generated badge must not retrigger indicator rendering');
assert.equal(api.isAccountStructureMutation({ type: 'childList', addedNodes: [], removedNodes: [badge] }), false, 'removing the generated badge must not retrigger indicator rendering');
assert.equal(api.isAccountStructureMutation({ type: 'childList', addedNodes: [textMutationNode], removedNodes: [] }), false, 'badge text replacement must not be treated as account structure');
assert.equal(api.isAccountStructureMutation({ type: 'childList', addedNodes: [account], removedNodes: [] }), true, 'adding a real account must rerender indicators');
assert.equal(api.isAccountStructureMutation({ type: 'childList', addedNodes: [wrapper], removedNodes: [] }), true, 'adding a subtree containing accounts must rerender indicators');

assert.match(source, /setTextIfChanged\(badge, label\)/, 'badge text writes must be idempotent');
assert.match(source, /setAttrIfChanged\(badge, 'title'/, 'badge title writes must be idempotent');
assert.match(source, /classList\?\.contains\('bc-account-job-state'\)/, 'observer must explicitly ignore its own badge mutations');
assert.match(source, /records\.some\(isAccountStructureMutation\)/, 'observer must rerender only for account structure changes');
assert.doesNotMatch(source, /const sidebar = document\.getElementById\('nav-accounts'\) \|\| document\.body/, 'indicator observer must never fall back to the full document body');
assert.doesNotMatch(source, /new MutationObserver\(rerender\)/, 'indicator must not rerender on every child mutation');

console.log('BROADCAST_ACCOUNT_INDICATOR_CONTRACT_OK');

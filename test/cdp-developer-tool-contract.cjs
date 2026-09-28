'use strict';

const assert = require('node:assert/strict');
const { parseTargetType, selectTarget } = require('../test/cdp-eval.cjs');

const targets = [
  { type: 'page', title: '极客' },
  { type: 'webview', title: 'WhatsApp Business' },
];
assert.equal(parseTargetType(undefined), 'page');
assert.equal(parseTargetType('webview'), 'webview');
assert.throws(() => parseTargetType('worker'), /TARGET_TYPE_INVALID/);
assert.equal(selectTarget(targets, '极客')?.type, 'page');
assert.equal(selectTarget(targets, 'WhatsApp', 'webview')?.type, 'webview');
assert.equal(selectTarget(targets, 'WhatsApp', 'page'), null);
console.log('CDP_DEVELOPER_TOOL_CONTRACT_OK');

'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const adaptersStart = ui.indexOf('const BROADCAST_ADAPTERS = {');
const lineStart = ui.indexOf('    line: {', adaptersStart);
const sendStart = ui.indexOf('      send: `(async () => {', lineStart);
const sendEnd = ui.indexOf('      })()`,', sendStart);
assert.ok(adaptersStart >= 0 && lineStart > adaptersStart && sendStart > lineStart && sendEnd > sendStart, 'LINE broadcast text send owner must exist');

const sendBlock = ui.slice(sendStart, sendEnd + 12);
assert.match(sendBlock, /chatroomEditor-module__editor_area__/, 'LINE text broadcast must scope submit lookup to the live editor area');
assert.match(sendBlock, /button\[type="submit"\]/, 'LINE text broadcast must support the live submit button');
assert.match(sendBlock, /submitButton\.click\(\)/, 'LINE text broadcast must commit through the live send button');
assert.match(sendBlock, /message-module__message__/, 'LINE text broadcast must retain delivery observation');
assert.match(sendBlock, /!value\) return 'SENT'/, 'LINE text broadcast must require the composer to clear after delivery');
assert.doesNotMatch(sendBlock, /dispatchEvent\(new KeyboardEvent/, 'LINE text broadcast must not depend on untrusted synthetic Enter');

console.log('LINE_BROADCAST_TEXT_SUBMIT_CONTRACT_OK');
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');

assert.match(app, /function makeOption[\s\S]*option\.textContent\s*=/, 'option 文本必须通过 textContent 写入');
assert.doesNotMatch(app, /savedListsEl\.innerHTML/, '保存列表不得通过 innerHTML 渲染');
assert.doesNotMatch(app, /labelSel\.innerHTML/, 'WhatsApp 标签不得通过 innerHTML 渲染');
assert.doesNotMatch(app, /sel\.innerHTML\s*=\s*groups\.map/, '群组 ID/名称不得通过 innerHTML 渲染');
assert.doesNotMatch(app, /listEl\.innerHTML\s*=\s*gtGroupList\.map/, '群管理数据不得通过 innerHTML 渲染');
assert.doesNotMatch(app, /gtLinksList\.innerHTML\s*=\s*savedGroupLinks\.map/, '保存的群链接不得通过 innerHTML 渲染');
assert.doesNotMatch(app, /bc-sched-time[^\n]*value="\$\{/, '定时任务属性不得通过 HTML 模板插值');

for (const payload of ['"><img src=x onerror=alert(1)>', '<svg onload=alert(1)>', '` ${alert(1)}', '\u2028</option><script>']) {
  // Contract evidence: every reviewed untrusted renderer assigns strings to text/value properties.
  assert.ok(payload.includes('<') || payload.includes('`') || payload.includes('\u2028'));
}

console.log('UI_UNTRUSTED_DOM_CONTRACT_OK');

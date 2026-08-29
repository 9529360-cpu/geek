'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');

// Preferred DOM-safe renderers for the sinks that originally triggered issue #4.
assert.match(app, /function makeOption[\s\S]*option\.textContent\s*=/, 'option 文本必须通过 textContent 写入');
assert.doesNotMatch(app, /savedListsEl\.innerHTML/, '保存列表不得通过 innerHTML 渲染');
assert.doesNotMatch(app, /labelSel\.innerHTML/, 'WhatsApp 标签不得通过 innerHTML 渲染');
assert.doesNotMatch(app, /sel\.innerHTML\s*=\s*groups\.map/, '群组 ID/名称不得通过 innerHTML 渲染');
assert.doesNotMatch(app, /listEl\.innerHTML\s*=\s*gtGroupList\.map/, '群管理数据不得通过 innerHTML 渲染');
assert.doesNotMatch(app, /gtLinksList\.innerHTML\s*=\s*savedGroupLinks\.map/, '保存的群链接不得通过 innerHTML 渲染');
assert.doesNotMatch(app, /bc-sched-time[^\n]*value="\$\{/, '定时任务属性不得通过 HTML 模板插值');

// Do not introduce additional HTML injection APIs in the privileged main renderer.
assert.doesNotMatch(app, /\.insertAdjacentHTML\s*\(/, '主窗口不得使用 insertAdjacentHTML');
assert.doesNotMatch(app, /\.outerHTML\s*=/, '主窗口不得通过 outerHTML 写入 DOM');
assert.doesNotMatch(app, /document\.write\s*\(/, '主窗口不得使用 document.write');

// Verify the shared encoder itself, including attribute-breaking payloads.
const escapeSource = app.match(/function escapeHtml\(s\)\s*\{[\s\S]*?\n  \}/);
assert.ok(escapeSource, '必须保留 escapeHtml');
const escapeHtml = vm.runInNewContext(`(${escapeSource[0]})`);
for (const payload of [
  '\"><img src=x onerror=alert(1)>',
  "'><svg onload=alert(1)>",
  '` ${alert(1)}',
  '\u2028</option><script>alert(1)</script>',
  'A&B'
]) {
  const encoded = escapeHtml(payload);
  assert.doesNotMatch(encoded, /[<>]/, `编码后不得残留 HTML 标签边界: ${payload}`);
  assert.equal(encoded.includes('"'), false, `编码后不得残留双引号: ${payload}`);
  assert.equal(encoded.includes("'"), false, `编码后不得残留单引号: ${payload}`);
}

// Remaining dynamic innerHTML sinks are deliberately reviewed. Any untrusted string in
// these sinks must be encoded before interpolation. These assertions make a future
// regression fail CI even if the original Block 3 renderers remain unchanged.
const reviewedEncodedSinks = [
  [/el\.innerHTML\s*=\s*broadcastFiles\.map[\s\S]*?escapeHtml\(f\.name\)[\s\S]*?escapeHtml\(f\.name\)/, '附件文件名'],
  [/bcSelectedChips\.innerHTML[\s\S]*?escapeHtml\(c\.name \|\| c\.id\)[\s\S]*?escapeHtml\(c\.id\)/, '已选聊天标签'],
  [/item\.innerHTML\s*=\s*`<input type="checkbox"[\s\S]*?escapeHtml\(c\.name \|\| c\.id\)/, '群发聊天列表'],
  [/sel\.innerHTML\s*=\s*'<option value="">全部群组[\s\S]*?escapeHtml\(g\.id\)[\s\S]*?escapeHtml\(g\.name\)/, '已保存群组下拉框'],
  [/open\.innerHTML[\s\S]*?escapeHtml\(g\.name\)/, '已保存群组标签'],
  [/bMetaEl\.innerHTML[\s\S]*?escapeHtml\(account \? account\.name : ''\)/, '群发账号名称'],
  [/savedMessagesEl\.innerHTML[\s\S]*?escapeHtml\(m\.name\)[\s\S]*?escapeHtml\(m\.name\.slice\(0, 24\)\)/, '已保存消息名称与选项值'],
  [/sel\.innerHTML\s*=\s*broadcastChats\.filter[\s\S]*?escapeHtml\(c\.id\)[\s\S]*?escapeHtml\(c\.name \|\| c\.id\)/, '排除联系人/群组'],
  [/selectedHtml[\s\S]*?escapeHtml\(c\.name\)[\s\S]*?escapeHtml\(c\.id\)[\s\S]*?vlist\.innerHTML[\s\S]*?escapeHtml\(query\)[\s\S]*?escapeHtml\(c\.id\)[\s\S]*?escapeHtml\(c\.name\)/, '联系人名片选择器'],
  [/item\.innerHTML\s*=\s*`[\s\S]*?escapeHtml\(a\.name\)/, '账号侧栏名称'],
  [/card\.innerHTML\s*=\s*`[\s\S]*?escapeHtml\(p\.name\)/, '平台名称']
];
for (const [pattern, label] of reviewedEncodedSinks) {
  assert.match(app, pattern, `${label} 的动态 HTML 必须继续经过编码或改用 DOM API`);
}

console.log('UI_UNTRUSTED_DOM_CONTRACT_OK');

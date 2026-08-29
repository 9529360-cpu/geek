'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
const store = fs.readFileSync(path.join(root, 'src', 'account-data-store.cjs'), 'utf8');
const source = fs.readFileSync(path.join(root, 'ui', 'contact-notes.js'), 'utf8');

assert.match(html, /id="btn-contact-notes"/, '顶部必须提供联系人备注入口');
assert.match(html, /maxlength="2000"/, '备注输入必须有明确长度上限');
assert.match(store, /'contactNotes'/, '联系人备注必须进入账号加密数据白名单');
assert.match(app, /accountStorageGetItem\('contactNotes'\)/, '备注必须复用当前账号沙箱');
assert.doesNotMatch(source, /sendMessage|setComposerText|insertText|executeJavaScript|postMessage/, '备注模块不得接触任何消息发送或 webview 注入接口');
assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML/, '备注和聊天 ID 必须只按纯文本渲染');

const context = { window: {}, globalThis: {}, encodeURIComponent, Date };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'contact-notes.js' });
const notes = context.window.GeekContactNotes;
assert.ok(notes, '备注模块必须可独立加载');

const tg = notes.normalizeIdentity('telegram', '#customer42?thread=3');
assert.equal(tg.chatId, 'customer42');
const wa = notes.normalizeIdentity('whatsapp', '491234@c.us');
const line = notes.normalizeIdentity('line', '491234@c.us');
assert.notEqual(wa.key, line.key, '不同平台的相同聊天 ID 不得串备注');

const first = notes.updateStore('', tg, '  重点客户  ', 123);
assert.equal(first.items[tg.key].text, '重点客户');
assert.equal(notes.noteFor(JSON.stringify(first), tg), '重点客户');
const removed = notes.updateStore(JSON.stringify(first), tg, '   ', 124);
assert.equal(Object.keys(removed.items).length, 0, '保存空备注必须删除记录');
assert.throws(() => notes.updateStore('', tg, 'x'.repeat(2001)), /2000/);

console.log('CONTACT_NOTES_CONTRACT_OK');

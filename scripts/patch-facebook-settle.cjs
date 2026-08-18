'use strict';
const fs = require('node:fs');
const path = require('node:path');
const file = path.resolve(__dirname, '..', 'ui', 'facebook-translation-adapter.js');
let source = fs.readFileSync(file, 'utf8');
const from = `      if (chatId) {\n        scan(document, 'initial');\n        setTimeout(() => { if (currentChatId() === chatId) scan(document, 'initial'); }, 900);\n      }`;
const to = `      if (chatId) {\n        scan(document, 'initial');\n        setTimeout(() => { if (currentChatId() === chatId) scan(document, 'initial'); }, 900);\n        // 稳定期内新增的真实消息可能被 MutationObserver 暂按 history 处理；稳定后补扫一次，避免漏译。\n        setTimeout(() => { if (currentChatId() === chatId) scan(document, 'new'); }, 2400);\n      }`;
if (!source.includes(from)) throw new Error('Facebook settle 补丁锚点不存在');
source = source.replace(from, to);
fs.writeFileSync(file, source, 'utf8');

const testFile = path.resolve(__dirname, '..', 'test', 'facebook-translation-contract.cjs');
let test = fs.readFileSync(testFile, 'utf8');
const testAnchor = `assert.match(adapterSource, /MutationObserver/,\n  'Facebook 动态消息列表必须由 MutationObserver 跟踪');`;
const testReplacement = `${testAnchor}\nassert.match(adapterSource, /setTimeout\\(\\(\\) => \\{ if \\(currentChatId\\(\\) === chatId\\) scan\\(document, 'new'\\); \\}, 2400\\);/,\n  'Facebook 聊天切换稳定期结束后必须补扫新消息，避免漏译');`;
if (!test.includes(testAnchor)) throw new Error('Facebook settle 测试锚点不存在');
test = test.replace(testAnchor, testReplacement);
fs.writeFileSync(testFile, test, 'utf8');
console.log('FACEBOOK_SETTLE_PATCH_OK');

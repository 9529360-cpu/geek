'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');

// 1) WAPLUS_EXTENSION_PATH 死代码已清理：不得再定义
assert.doesNotMatch(main, /WAPLUS_EXTENSION_PATH\s*=/, 'WAPLUS_EXTENSION_PATH 常量不得再定义（死代码）');
assert.match(main, /PRAGMAZ_EXTENSION_PATH/, '实际加载的 Pragmaz 扩展路径必须保留');

// 2) WA 媒体发送链语义锁定（HelloWorld 同款，大图不卡——File 对象直传，不经 base64）
assert.match(main, /createFromData\(file, file\.type\)/, '媒体必须走 createFromData（File 对象直传）');
assert.match(main, /prepRawMedia/, '必须调用 prepRawMedia');
assert.match(main, /sendMediaMsgToChat/, '必须调用 sendMediaMsgToChat');
assert.doesNotMatch(main, /readAsDataURL|toDataURL/, '媒体发送不得经 DataURL 读取（大图不卡）');
assert.match(main, /ChatStore\.get/, '必须通过 ChatStore.get 取聊天模型');

// 3) WPP 注入保留（扩展就绪标记）
assert.match(main, /injectWppWithRetry/, 'WPP 注入重试逻辑必须保留');
assert.match(main, /WAPLUS_WPP \|\| window\.WPP/, '页面 API 必须兼容 WAPLUS_WPP 与 WPP');

console.log('WPP_CONVERGE_CONTRACT_OK');

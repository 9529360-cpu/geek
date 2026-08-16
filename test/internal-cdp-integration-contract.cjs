'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');

assert.match(main, /require\('\.\/internal-cdp\.cjs'\)/, '主进程必须加载应用内CDP模块');
assert.match(main, /createInternalCdp\(/, '必须创建应用内CDP管理器');
assert.match(main, /externalDebuggingActive/, '必须探测外部调试端口状态');
assert.match(main, /broadcast:send-file/, 'send-file处理器必须保留');
assert.match(main, /broadcast:attach-file/, 'attach-file处理器必须保留');
assert.match(main, /broadcast:drop-file/, 'drop-file处理器必须保留');
assert.match(main, /#__hw_file_input/, 'WA媒体链隐藏input必须保留');
assert.match(main, /DOM\.setFileInputFiles/, 'File注入必须保留');
assert.match(main, /sendMediaMsgToChat/, 'HelloWorld媒体发送链路必须保留');
assert.match(main, /Input\.dispatchDragEvent/, '真实拖拽必须保留');
assert.match(main, /createFromData/, 'createFromData媒体API必须保留');
assert.match(main, /prepRawMedia/, 'prepRawMedia媒体API必须保留');

console.log('INTERNAL_CDP_INTEGRATION_CONTRACT_OK');

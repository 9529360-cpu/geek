'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const bridge = fs.readFileSync(path.join(__dirname, '../resources/bridge-preload.cjs'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '../src/preload.cjs'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const adapters = fs.readFileSync(path.join(__dirname, '../ui/translation-adapters.js'), 'utf8');

// 1. guest preload：隔离世界，postMessage 收口 + sendToHost 上报 + DOM 标记
assert.match(bridge, /ipcRenderer\.sendToHost\(/, 'guest preload 必须用 sendToHost');
assert.match(bridge, /geek-bridge/, 'sendToHost 通道必须为 geek-bridge');
assert.match(bridge, /__geekBridge/, '必须校验页面消息标记');
assert.match(bridge, /event\.source !== window/, '必须校验同窗口来源');
assert.match(bridge, /data-geek-bridge/, '必须设置 DOM 可用性标记');

// 2. 主进程提供 preload 路径
assert.match(main, /bridge:get-preload-path/, '主进程必须注册 bridge:get-preload-path');
assert.match(main, /bridge-preload\.cjs/, '必须指向 resources/bridge-preload.cjs');

// 3. 嵌入侧 preload 暴露路径 API
assert.match(preload, /preloadPath: \(\) => ipcRenderer\.invoke\('bridge:get-preload-path'\)/, '嵌入侧 preload 必须暴露 preloadPath');

// 4. renderer：WA/TG webview 设置 preload（LINE 除外）；监听 geek-bridge；保留 console 兜底
assert.match(app, /setAttribute\('preload', bridgePreloadPath\)/, 'renderer 必须设置 webview preload 属性');
assert.match(app, /account\.type !== 'line' && account\.type !== 'line-business'/, 'LINE 不得叠加新 preload');
assert.match(app, /handleGeekBridgeIpc/, 'renderer 必须处理 geek-bridge ipc-message');
assert.match(app, /data-geek-bridge/, '页面侧必须检测桥可用性标记');
assert.match(app, /window\.postMessage\(\{ __geekBridge: true/, 'WA 页面侧必须用 postMessage 上报');
assert.match(app, /TRANSLATION_REQUEST_PREFIX/, '必须保留 console 兜底（翻译）');
assert.match(app, /NATIVE_INPUT_REQUEST_PREFIX/, '必须保留 console 兜底（原生输入）');
assert.match(adapters, /data-geek-bridge/, 'TG 适配器必须检测桥可用性标记');
assert.match(adapters, /native-input-request/, 'TG 原生输入必须走新桥');

// 5. 语义不变量：缓存/历史/20并发仍在主进程 translation:translate；不引入快捷话术
assert.match(main, /translation:translate/, '主进程翻译 IPC 必须保留');
assert.match(main, /concurrency|并发|MAX_CONCURRENT|Semaphore|queue/i, '20并发队列必须保留');
assert.match(adapters, /translateHistory|transOldHistory|history/, '历史消息策略必须保留');
assert.doesNotMatch(adapters + main + app, /快捷话术|quickPhrase|quick-phrase/i, '不得恢复快捷话术');

console.log('BRIDGE_IPC_CONTRACT_OK');

'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');
const runtimeOwner = fs.readFileSync(path.join(__dirname, '../src/translation-runtime.cjs'), 'utf8');
const runtimeBase = fs.readFileSync(path.join(__dirname, '../src/translation-runtime-base.cjs'), 'utf8');
const scheduler = fs.readFileSync(path.join(__dirname, '../src/translation-smart-queue.cjs'), 'utf8');

assert.match(main, /createTranslationRuntime/, '主进程必须组合 Translation Runtime owner');
assert.match(runtimeOwner, /translation-runtime-base\.cjs/, '公共 Translation Runtime owner 必须组合内部网关事务层');
assert.match(runtimeOwner, /translation-smart-queue\.cjs/, '公共 Translation Runtime owner 必须先经过优先级准入层');
assert.match(runtimeBase, /createGatewayPool\(/, 'Translation Runtime base 必须创建网关池');
assert.match(runtimeBase, /GEEK_TRANSLATION_GATEWAY_URL/, '环境变量必须支持多端点配置');
assert.match(runtimeBase, /\.split\(','\)/, '环境变量必须支持逗号分隔多端点');
assert.match(runtimeBase, /pool\.pick\(body\.route\)/, '翻译请求必须把规范化 route 交给唯一网关池 owner 选端点');
assert.match(runtimeBase, /pool\.reportFailure\(endpoint\)/, '失败必须上报池');
assert.match(runtimeBase, /pool\.reportSuccess\(endpoint\)/, '成功必须上报池');
assert.match(runtimeBase, /pool\.healthCheckAll\(\)/, '健康检查必须探测全部端点');
assert.match(runtimeBase, /route:\s*picked\.route/, 'Worker 必须收到实际选中的 primary|backup 线路，而不是仅回显请求标签');
assert.match(runtimeBase, /body\.route === 'primary'/, '显式主线路必须拥有独立的端点尝试边界');
assert.match(runtimeBase, /body\.route === 'backup'/, '显式备用线路必须拥有独立的端点尝试边界');
assert.match(runtimeBase, /TRANSLATION_REMOTE_LIMIT = 20/, '内部远程上限必须继续保持 20');
assert.match(runtimeOwner, /concurrency: base\.TRANSLATION_REMOTE_LIMIT/, '外层智能准入必须绑定同一总并发上限');
assert.match(scheduler, /outgoingReserve/, '发送前翻译必须拥有保留容量');
assert.match(runtimeBase, /state\.inflight|loadCache|appendCache/, '缓存与去重必须保留');
assert.match(runtimeBase, /isHistory === true && body\.translateHistory !== true/, '历史消息策略必须保留');

console.log('GATEWAY_FAILOVER_INTEGRATION_CONTRACT_OK');

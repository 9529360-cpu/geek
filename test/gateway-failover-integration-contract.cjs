'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');
const runtime = fs.readFileSync(path.join(__dirname, '../src/translation-runtime.cjs'), 'utf8');

assert.match(main, /createTranslationRuntime/, '主进程必须组合 Translation Runtime owner');
assert.match(runtime, /createGatewayPool\(/, 'Translation Runtime 必须创建网关池');
assert.match(runtime, /GEEK_TRANSLATION_GATEWAY_URL/, '环境变量必须支持多端点配置');
assert.match(runtime, /\.split\(','\)/, '环境变量必须支持逗号分隔多端点');
assert.match(runtime, /pool\.pick\(\)/, '翻译请求必须从池中选端点');
assert.match(runtime, /pool\.reportFailure\(endpoint\)/, '失败必须上报池');
assert.match(runtime, /pool\.reportSuccess\(endpoint\)/, '成功必须上报池');
assert.match(runtime, /pool\.healthCheckAll\(\)/, '健康检查必须探测全部端点');
assert.match(runtime, /route: body\.route \|\| picked\.route/, 'route=primary|backup 必须落地');
assert.match(runtime, /remoteQueue|TRANSLATION_REMOTE_LIMIT = 20/, '20并发队列必须保留');
assert.match(runtime, /state\.inflight|loadCache|appendCache/, '缓存与去重必须保留');
assert.match(runtime, /isHistory === true && body\.translateHistory !== true/, '历史消息策略必须保留');

console.log('GATEWAY_FAILOVER_INTEGRATION_CONTRACT_OK');

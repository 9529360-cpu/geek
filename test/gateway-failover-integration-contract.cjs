'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');

assert.match(main, /require\('\.\/gateway-failover\.cjs'\)/, '主进程必须加载端点池模块');
assert.match(main, /createGatewayPool\(/, '主进程必须创建网关池');
assert.match(main, /GEEK_TRANSLATION_GATEWAY_URL/, '环境变量必须支持多端点配置');
assert.match(main, /\.split\(','\)/, '环境变量必须支持逗号分隔多端点');
assert.match(main, /pool\.pick\(\)/, '翻译请求必须从池中选端点');
assert.match(main, /pool\.reportFailure\(endpoint\)/, '失败必须上报池');
assert.match(main, /pool\.reportSuccess\(endpoint\)/, '成功必须上报池');
assert.match(main, /pool\.healthCheckAll\(\)/, '健康检查必须探测全部端点');
assert.match(main, /route: body\.route \|\| picked\.route/, 'route=primary|backup 必须落地');
assert.match(main, /translationRemoteQueue|TRANSLATION_REMOTE_LIMIT = 20/, '20并发队列必须保留');
assert.match(main, /translationInflight|loadTranslationCache|appendTranslationCache/, '缓存与去重必须保留');
assert.match(main, /isHistory === true && body\.translateHistory !== true/, '历史消息策略必须保留');

console.log('GATEWAY_FAILOVER_INTEGRATION_CONTRACT_OK');

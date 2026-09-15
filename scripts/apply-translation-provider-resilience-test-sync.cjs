'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'test', 'translation-usage-state-contract.cjs');
const workflow = path.join(root, '.github', 'workflows', 'apply-translation-provider-resilience-test-sync.yml');
const self = __filename;
let source = fs.readFileSync(target, 'utf8');
const before = "    assert.equal(upstreamCalls, 2);";
const after = "    assert.equal(upstreamCalls, 3, 'failed logical request gets one bounded transient retry, then the later user retry makes one successful provider call');";
if (!source.includes(before)) throw new Error('missing usage-contract retry anchor');
if (source.indexOf(before) !== source.lastIndexOf(before)) throw new Error('ambiguous usage-contract retry anchor');
source = source.replace(before, after);
fs.writeFileSync(target, source);
for (const file of [self, workflow]) { try { fs.rmSync(file); } catch {} }
console.log('TRANSLATION_USAGE_RETRY_CONTRACT_SYNC_OK');

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const runner = fs.readFileSync(path.join(root, 'e2e', 'run.cjs'), 'utf8');

assert.match(runner, /const DEFAULT_RUN_TIMEOUT_MS = 120_000;/, 'targeted and restart E2E invocations must retain the bounded 120s watchdog');
assert.match(runner, /const FULL_SUITE_TIMEOUT_MS = 180_000;/, 'the sequential full Electron suite needs a bounded budget above the observed 120s runtime');
assert.match(
  runner,
  /function runTimeoutMs\(configName, specPath\) \{\s*return configName === 'wdio\.conf\.cjs' && !specPath\s*\? FULL_SUITE_TIMEOUT_MS\s*:\s*DEFAULT_RUN_TIMEOUT_MS;\s*\}/s,
  'only the unfiltered full wdio.conf.cjs invocation may use the larger watchdog budget',
);
assert.match(runner, /setTimeout\(\(\) => \{[\s\S]*?\}, runTimeoutMs\(configName, specPath\)\);/, 'the process watchdog must use the suite-aware timeout selector');
assert.match(runner, /await runWdio\('wdio\.scheduled-restart\.conf\.cjs', 'seed'\);/);
assert.match(runner, /await runWdio\('wdio\.scheduled-restart\.conf\.cjs', 'verify'\);/);
assert.match(runner, /await runWdio\('wdio\.conf\.cjs'\);/);
assert.match(runner, /runWdio\('wdio\.conf\.cjs', undefined, selectedSpec\)/, 'targeted suites must stay filtered and therefore keep the default watchdog');

console.log('electron e2e runner timeout contract passed');

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');

assert.match(source, /require\(['"]\.\/line-context-isolation-policy\.cjs['"]\)/);
assert.match(source, /isLineContextIsolationCandidateEnabled\(\{[\s\S]*?isPackaged:\s*app\.isPackaged,[\s\S]*?env:\s*process\.env,[\s\S]*?\}\)/);
assert.match(source, /applyLineContextIsolationPolicy\(\{[\s\S]*?webPreferences,[\s\S]*?candidateEnabled:\s*LINE_CONTEXT_ISOLATION_CANDIDATE,[\s\S]*?legacyPreloadPath:\s*path\.join\(__dirname,\s*'\.\.',\s*'resources',\s*'s3loYR\.js'\),[\s\S]*?\}\)/);
assert.match(source, /lineWebPreferencesAttribute\(LINE_CONTEXT_ISOLATION_CANDIDATE\)/);

console.log('LINE_CONTEXT_ISOLATION_MAIN_INTEGRATION_CONTRACT_OK');

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dir = path.resolve(__dirname, '../test');
const tests = fs.readdirSync(dir).filter((name) => name.endsWith('.test.mjs')).sort()
  .map((name) => path.join(dir, name));
if (!tests.length) throw new Error('No Tauri frontend tests found');
const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
if (result.error || result.signal) {
  console.error('Tauri frontend test process could not complete');
  process.exit(1);
}
process.exit(result.status ?? 1);

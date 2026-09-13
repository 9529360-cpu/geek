'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

// FH-08 mutation proof only. This intentionally recreates an active production
// read/write authority for the legacy LINE token file and must never be merged.
const target = path.join(app.getPath('userData'), 'line-tokens.json');
let current = '{}';
try {
  current = fs.readFileSync(target, 'utf8');
} catch {
  // Missing legacy file is intentionally created by this mutation.
}
fs.writeFileSync(target, current || '{}', 'utf8');

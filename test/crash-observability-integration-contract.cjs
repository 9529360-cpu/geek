'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const entry = fs.readFileSync(path.join(__dirname, '../src/main-entry.cjs'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');
const moduleSource = fs.readFileSync(path.join(__dirname, '../src/crash-observability.cjs'), 'utf8');

// The reporter must start before any window exists, i.e. in main-entry
// before main.cjs is required.
assert.match(entry, /require\('\.\/crash-observability\.cjs'\)/, 'main-entry must load the crash observability module');
assert.match(entry, /installCrashReporting\(\{/, 'main-entry must start crash reporting');
assert.ok(
  entry.indexOf('installCrashReporting({') < entry.indexOf("require('./main.cjs')"),
  'crash reporting must start before main.cjs is required',
);

// Startup reporting + pruning must be wired into the main process.
assert.match(main, /require\('\.\/crash-observability\.cjs'\)/, 'main.cjs must load the crash observability module');
assert.match(main, /reportPreviousNativeCrash\(\{/, 'main.cjs must report a previous native crash on startup');
assert.match(main, /pruneCrashDumps\(\{/, 'main.cjs must prune old local dumps on startup');

// Local-only is a hard boundary: no upload target property, no upload flag.
assert.doesNotMatch(moduleSource, /submitURL\s*:/, 'crash observability must never configure an upload target');
assert.doesNotMatch(moduleSource, /uploadToServer:\s*true/, 'crash reporting must never upload');
assert.match(moduleSource, /uploadToServer:\s*false/, 'crash reporting must explicitly disable upload');

// The only diagnostics event carries date + id; dump content never enters logs.
assert.match(moduleSource, /previous-session-native-crash/, 'previous native crashes must be surfaced as a diagnostics event');
assert.doesNotMatch(
  moduleSource,
  /diagnostics\.log\([^\\n]*chat(Text|Body)|diagnostics\.log\([^\\n]*message(Text|Body)/,
  'crash diagnostics must not carry chat content',
);

console.log('CRASH_OBSERVABILITY_INTEGRATION_CONTRACT_OK');

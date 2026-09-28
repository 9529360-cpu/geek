'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourceRoots = ['test', 'e2e', 'scripts'];
const moduleDriveSpecifier = /(?:require|import)\s*\(\s*['"`][A-Za-z]:[\\/]/;
const staticDriveImport = /(?:from|import)\s+['"`][A-Za-z]:[\\/]/;

function sourceFiles(directory) {
  const out = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(absolute));
    else if (/\.(?:cjs|mjs|js)$/.test(entry.name)) out.push(absolute);
  }
  return out;
}

for (const relativeRoot of sourceRoots) {
  for (const file of sourceFiles(path.join(root, relativeRoot))) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      moduleDriveSpecifier,
      'test/tool module imports must not depend on a developer Windows drive: ' + path.relative(root, file),
    );
    assert.doesNotMatch(
      source,
      staticDriveImport,
      'static imports must not depend on a developer Windows drive: ' + path.relative(root, file),
    );
  }
}

console.log('TEST_MODULE_PATH_PORTABILITY_CONTRACT_OK');

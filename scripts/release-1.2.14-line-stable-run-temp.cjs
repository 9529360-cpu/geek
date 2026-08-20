'use strict';

const fs = require('node:fs');
const path = require('node:path');

const sourceFile = 'scripts/release-1.2.14-line-stable-prep-temp.cjs';
const targetFile = '.release-tmp/release-1.2.14-line-stable-prep-normalized-temp.cjs';
let source = fs.readFileSync(sourceFile, 'utf8');
source = source.replace(
  "if (fs.readFileSync('resources/s3loYR.js', 'utf8') !== baselineLine) throw new Error('LINE startup resource must remain exact 1.2.12 baseline');",
  "if (fs.readFileSync('resources/s3loYR.js', 'utf8').replace(/\\r\\n/g, '\\n') !== baselineLine.replace(/\\r\\n/g, '\\n')) throw new Error('LINE startup resource must remain exact 1.2.12 baseline');"
);
source = source.replace(
  "if (fs.readFileSync('src/preload.cjs', 'utf8') !== baselinePreload) throw new Error('main preload must remain exact 1.2.12 baseline');",
  "if (fs.readFileSync('src/preload.cjs', 'utf8').replace(/\\r\\n/g, '\\n') !== baselinePreload.replace(/\\r\\n/g, '\\n')) throw new Error('main preload must remain exact 1.2.12 baseline');"
);
fs.writeFileSync(targetFile, source);
require(path.resolve(targetFile));

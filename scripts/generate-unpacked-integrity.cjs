'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { buildRuntimeIntegrityManifest } = require('../src/unpacked-integrity.cjs');

const root = path.join(__dirname, '..');
const resourcesDir = path.join(root, 'resources');
const outputPath = path.join(root, 'src', 'unpacked-integrity.generated.json');

async function generate(options = {}) {
  const sourceResources = options.resourcesDir || resourcesDir;
  const target = options.outputPath || outputPath;
  const manifest = await buildRuntimeIntegrityManifest(sourceResources);
  await fs.writeFile(target, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return { manifest, outputPath: target };
}

if (require.main === module) {
  generate().then(({ manifest }) => {
    console.log(`[integrity] generated bridge + LINE manifest (${manifest.components.lineExtension.fileCount} LINE files)`);
  }).catch((error) => {
    console.error(`[integrity] manifest generation failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { generate };

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MANIFEST_VERSION = 1;
const BRIDGE_RELATIVE_PATH = 'bridge-preload.cjs';
const LINE_EXTENSION_RELATIVE_PATH = 'extensions/line-3.5.1';

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function collectTreeFiles(rootDir, currentDir = rootDir, output = []) {
  const entries = await fsp.readdir(currentDir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const entry of entries) {
    const absolute = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await collectTreeFiles(rootDir, absolute, output);
      continue;
    }
    if (!entry.isFile()) continue;
    output.push(path.relative(rootDir, absolute).split(path.sep).join('/'));
  }
  return output;
}

async function sha256Tree(rootDir) {
  const files = await collectTreeFiles(rootDir);
  const aggregate = crypto.createHash('sha256');
  for (const relative of files) {
    const digest = await sha256File(path.join(rootDir, ...relative.split('/')));
    aggregate.update(relative, 'utf8');
    aggregate.update('\0');
    aggregate.update(digest, 'ascii');
    aggregate.update('\n');
  }
  return { sha256: aggregate.digest('hex'), fileCount: files.length };
}

function validSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

async function buildRuntimeIntegrityManifest(resourcesDir) {
  const bridgePath = path.join(resourcesDir, BRIDGE_RELATIVE_PATH);
  const linePath = path.join(resourcesDir, ...LINE_EXTENSION_RELATIVE_PATH.split('/'));
  const [bridgeSha, lineTree] = await Promise.all([
    sha256File(bridgePath),
    sha256Tree(linePath)
  ]);
  if (!lineTree.fileCount) throw new Error('LINE extension tree is empty');
  return {
    version: MANIFEST_VERSION,
    components: {
      bridge: {
        kind: 'file',
        path: BRIDGE_RELATIVE_PATH,
        sha256: bridgeSha
      },
      lineExtension: {
        kind: 'tree',
        path: LINE_EXTENSION_RELATIVE_PATH,
        sha256: lineTree.sha256,
        fileCount: lineTree.fileCount
      }
    }
  };
}

async function verifyRuntimeIntegrity({ manifestPath, resourcesDir }) {
  const result = {
    manifestOk: false,
    bridge: false,
    lineExtension: false,
    errors: []
  };
  let manifest;
  try {
    manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  } catch {
    result.errors.push('manifest');
    return result;
  }
  if (manifest?.version !== MANIFEST_VERSION || !manifest.components) {
    result.errors.push('manifest');
    return result;
  }
  result.manifestOk = true;

  const bridge = manifest.components.bridge;
  if (
    bridge?.kind === 'file' &&
    bridge.path === BRIDGE_RELATIVE_PATH &&
    validSha(bridge.sha256)
  ) {
    try {
      result.bridge = (await sha256File(path.join(resourcesDir, BRIDGE_RELATIVE_PATH))) === bridge.sha256;
    } catch {
      result.bridge = false;
    }
  }
  if (!result.bridge) result.errors.push('bridge');

  const line = manifest.components.lineExtension;
  if (
    line?.kind === 'tree' &&
    line.path === LINE_EXTENSION_RELATIVE_PATH &&
    validSha(line.sha256) &&
    Number.isInteger(line.fileCount) &&
    line.fileCount > 0
  ) {
    try {
      const actual = await sha256Tree(path.join(resourcesDir, ...LINE_EXTENSION_RELATIVE_PATH.split('/')));
      result.lineExtension = actual.sha256 === line.sha256 && actual.fileCount === line.fileCount;
    } catch {
      result.lineExtension = false;
    }
  }
  if (!result.lineExtension) result.errors.push('line-extension');
  return result;
}

module.exports = {
  MANIFEST_VERSION,
  BRIDGE_RELATIVE_PATH,
  LINE_EXTENSION_RELATIVE_PATH,
  sha256File,
  sha256Tree,
  buildRuntimeIntegrityManifest,
  verifyRuntimeIntegrity
};

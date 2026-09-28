'use strict';

const fs = require('node:fs');
const path = require('node:path');

function normalizeRelativePath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
}

function fileSignature(fsModule, absolutePath) {
  try {
    const stat = fsModule.statSync(absolutePath);
    if (!stat.isFile()) return null;
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return null;
  }
}

function scanTree(root, relativeRoot, fsModule = fs) {
  const normalizedRoot = normalizeRelativePath(relativeRoot);
  const out = new Map();
  const start = path.join(root, ...normalizedRoot.split('/').filter(Boolean));

  function walk(absoluteDir, relativeDir) {
    let entries;
    try {
      entries = fsModule.readdirSync(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relativePath = normalizeRelativePath(path.posix.join(relativeDir, entry.name));
      const absolutePath = path.join(absoluteDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        const signature = fileSignature(fsModule, absolutePath);
        if (signature !== null) out.set(relativePath, signature);
      }
    }
  }

  walk(start, normalizedRoot);
  return out;
}

function createWatchSnapshot({ root, fsModule = fs } = {}) {
  if (!root) throw new TypeError('root is required');
  const signatures = new Map();

  function prime(relativeRoot) {
    const next = scanTree(root, relativeRoot, fsModule);
    for (const [relativePath, signature] of next) signatures.set(relativePath, signature);
    return next.size;
  }

  function diff(relativeRoot) {
    const normalizedRoot = normalizeRelativePath(relativeRoot);
    const prefix = normalizedRoot ? normalizedRoot + '/' : '';
    const next = scanTree(root, normalizedRoot, fsModule);
    const keys = new Set(next.keys());
    for (const key of signatures.keys()) {
      if (key === normalizedRoot || (prefix && key.startsWith(prefix))) keys.add(key);
    }

    const changed = [];
    for (const key of keys) {
      const previous = signatures.get(key);
      const current = next.get(key);
      if (previous !== current) changed.push(key);
      if (current === undefined) signatures.delete(key);
      else signatures.set(key, current);
    }
    return changed.sort();
  }

  return Object.freeze({
    prime,
    diff,
    size: () => signatures.size,
  });
}

module.exports = {
  createWatchSnapshot,
  fileSignature,
  normalizeRelativePath,
  scanTree,
};

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SENSITIVE_KEY_FRAGMENTS = ['authorization', 'cookie', 'apikey', 'token', 'secret', 'password'];
const DROP_KEY_FRAGMENTS = ['chattext', 'chatbody', 'messagebody', 'messagetext', 'content'];

function isSensitiveKey(key) {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_FRAGMENTS.some(frag => lower.includes(frag));
}

function isDropKey(key) {
  const lower = key.toLowerCase();
  return DROP_KEY_FRAGMENTS.some(frag => lower.includes(frag));
}

function sanitizeValue(value, key) {
  if (typeof value === 'string') {
    if (key.toLowerCase() === 'url') {
      try {
        const url = new URL(value);
        url.search = '';
        url.hash = '';
        url.username = '';
        url.password = '';
        return url.toString();
      } catch {
        return value;
      }
    }
    if (isSensitiveKey(key)) {
      return '[REDACTED]';
    }
    return value;
  }
  return value;
}

function sanitizeMetadata(obj) {
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeMetadata(item));
  }
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (isDropKey(key)) {
        continue;
      }
      if (isSensitiveKey(key)) {
        result[key] = '[REDACTED]';
      } else if (value && typeof value === 'object') {
        result[key] = sanitizeMetadata(value);
      } else {
        result[key] = sanitizeValue(value, key);
      }
    }
    return result;
  }
  return obj;
}

function createDiagnostics(options) {
  const dir = options.dir;
  fs.mkdirSync(dir, { recursive: true });
  const maxBytes = options.maxBytes || 1024 * 1024;
  const maxFiles = options.maxFiles || 5;
  const now = options.now || (() => new Date().toISOString());

  let currentFile = null;
  let currentSize = 0;
  let fileIndex = 0;

  function getNextFile() {
    const timestamp = now().replace(/[:.]/g, '-');
    const name = `diagnostics-${timestamp}-${fileIndex}.jsonl`;
    fileIndex++;
    return path.join(dir, name);
  }

  function rotateIfNeeded() {
    if (currentFile && currentSize >= maxBytes) {
      currentFile = null;
      currentSize = 0;
    }
    if (!currentFile) {
      currentFile = getNextFile();
      currentSize = 0;
    }
  }

  function cleanupOldFiles() {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort();
    while (files.length > maxFiles) {
      const oldest = files.shift();
      fs.unlinkSync(path.join(dir, oldest));
    }
  }

  function log(eventName, metadata) {
    rotateIfNeeded();
    const entry = {
      timestamp: now(),
      event: eventName,
      metadata: sanitizeMetadata(metadata || {})
    };
    const line = JSON.stringify(entry) + '\n';
    const lineBytes = Buffer.byteLength(line, 'utf8');
    if (currentSize + lineBytes > maxBytes && currentSize > 0) {
      currentFile = null;
      currentSize = 0;
      rotateIfNeeded();
    }
    fs.appendFileSync(currentFile, line, 'utf8');
    currentSize += lineBytes;
    cleanupOldFiles();
  }

  return { log };
}

module.exports = { sanitizeMetadata, createDiagnostics };

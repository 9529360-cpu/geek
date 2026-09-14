'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SENSITIVE_KEY_FRAGMENTS = [
  'authorization', 'cookie', 'apikey', 'token', 'secret', 'password',
  'credential', 'session', 'email', 'phone', 'login', 'username'
];
const DROP_KEY_FRAGMENTS = ['chattext', 'chatbody', 'messagebody', 'messagetext', 'content'];

function isSensitiveKey(key) {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_FRAGMENTS.some(frag => lower.includes(frag));
}

function isDropKey(key) {
  const lower = key.toLowerCase();
  return DROP_KEY_FRAGMENTS.some(frag => lower.includes(frag));
}

function sanitizeUrl(value) {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    // 即使 URL 不完整/非法，也不能因为解析失败而把 query/hash 原样写入日志。
    // 同时尽力去掉 scheme 后的 userinfo，避免 malformed URL 泄露 user:password@host。
    const withoutQuery = String(value).replace(/[?#].*$/, '');
    return withoutQuery.replace(/^([a-z][a-z0-9+.-]*:\/\/)(?:[^/@]+@)/i, '$1[REDACTED]@');
  }
}

function sanitizeValue(value, key) {
  if (typeof value === 'string') {
    if (key.toLowerCase() === 'url') {
      return sanitizeUrl(value);
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

  // 每次写入前确保目录存在：老版本 ACL 损坏时 mkdir 不重建已存在目录，
  // 因此修复 ACL 后本函数自动成功，无需重新初始化 diagnostics 对象。
  function ensureDir() {
    try {
      fs.mkdirSync(dir, { recursive: true });
      return true;
    } catch {
      return false;
    }
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

  function diagnosticGeneration(name) {
    const match = /^diagnostics-(.+)-(\d+)\.jsonl$/.exec(String(name || ''));
    if (!match) return null;
    return { timestamp: match[1], index: Number(match[2]) };
  }

  function cleanupOldFiles() {
    const files = fs.readdirSync(dir)
      .map(name => ({ name, generation: diagnosticGeneration(name) }))
      .filter(item => item.generation)
      .sort((left, right) => {
        if (left.generation.timestamp < right.generation.timestamp) return -1;
        if (left.generation.timestamp > right.generation.timestamp) return 1;
        return left.generation.index - right.generation.index;
      });
    while (files.length > maxFiles) {
      const oldest = files.shift();
      fs.unlinkSync(path.join(dir, oldest.name));
    }
  }

  function log(eventName, metadata) {
    try {
      // 目录不可用（ACL 损坏/未创建）时静默降级；ACL 修复后下次调用自动恢复
      if (!ensureDir()) {
        currentFile = null;
        currentSize = 0;
        return;
      }
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
    } catch (e) {
      // 诊断日志失败绝不影响主流程（ACL/磁盘异常时静默降级）
      currentFile = null;
      currentSize = 0;
    }
  }

  return { log };
}

module.exports = { sanitizeMetadata, createDiagnostics };

'use strict';

const crypto = require('node:crypto');
const path = require('node:path');

const MiB = 1024 * 1024;
const DEFAULT_LIMITS = Object.freeze({ maxFiles: 10, maxFileBytes: 512 * MiB, maxTotalBytes: 1024 * MiB });
const MIME_BY_EXT = Object.freeze({
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain', '.csv': 'text/csv', '.zip': 'application/zip', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg',
});
function policyError(code, publicMessage) { const error = new Error(code); error.code = code; error.publicMessage = publicMessage || code; return error; }
function requiredId(value, code) { const text = String(value == null ? '' : value).trim(); if (!text) throw policyError(code); return text; }
function normalizeStat(stat) {
  if (!stat || typeof stat.isFile !== 'function' || !stat.isFile()) throw policyError('SCHEDULED_BROADCAST_ATTACHMENT_UNAVAILABLE', '定时附件已不可用，请重新选择。');
  const size = Number(stat.size), mtimeMs = Number(stat.mtimeMs);
  if (!Number.isSafeInteger(size) || size < 0 || !Number.isFinite(mtimeMs)) throw policyError('SCHEDULED_BROADCAST_ATTACHMENT_UNAVAILABLE', '定时附件已不可用，请重新选择。');
  return { size, mtimeMs };
}
function guessMime(filePath, pathModule) { return MIME_BY_EXT[pathModule.extname(filePath).toLowerCase()] || 'application/octet-stream'; }
function publicRecord(entry) { return Object.freeze({ ref: entry.ref, name: entry.name, size: entry.size, mime: entry.mime }); }

function createScheduledBroadcastAttachmentStore(options = {}) {
  const fs = options.fs;
  if (!fs || typeof fs.realpath !== 'function' || typeof fs.stat !== 'function' || typeof fs.readFile !== 'function' || typeof fs.writeFile !== 'function' || typeof fs.rename !== 'function' || typeof fs.mkdir !== 'function') throw new TypeError('fs with realpath/stat/readFile/writeFile/rename/mkdir is required');
  const storePath = String(options.storePath || '');
  if (!storePath) throw new TypeError('storePath is required');
  const pathModule = options.pathModule || path;
  const randomBytes = options.randomBytes || crypto.randomBytes;
  const limits = Object.freeze({ ...DEFAULT_LIMITS, ...(options.limits || {}) });
  const entries = new Map();
  let initPromise = null;
  let mutationQueue = Promise.resolve();

  function nextRef() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const ref = randomBytes(24).toString('hex');
      if (/^[a-f0-9]{48}$/.test(ref) && !entries.has(ref)) return ref;
    }
    throw policyError('SCHEDULED_BROADCAST_ATTACHMENT_REF_GENERATION_FAILED');
  }
  function serialize() { return JSON.stringify({ version: 1, entries: [...entries.values()] }); }
  async function writeSnapshot(snapshot) {
    await fs.mkdir(pathModule.dirname(storePath), { recursive: true });
    const tempPath = `${storePath}.tmp`;
    await fs.writeFile(tempPath, snapshot, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tempPath, storePath);
  }
  function enqueueMutation(operation) { const run = mutationQueue.catch(() => {}).then(operation); mutationQueue = run.catch(() => {}); return run; }

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      let raw = '';
      try { raw = await fs.readFile(storePath, 'utf8'); }
      catch (error) { if (error && error.code === 'ENOENT') return; throw error; }
      let parsed;
      try { parsed = JSON.parse(raw || '{}'); } catch { throw policyError('SCHEDULED_BROADCAST_ATTACHMENT_STORE_CORRUPT'); }
      for (const entry of Array.isArray(parsed?.entries) ? parsed.entries : []) {
        const ref = String(entry?.ref || ''), accountId = String(entry?.accountId || ''), taskId = String(entry?.taskId || ''), canonicalPath = String(entry?.canonicalPath || '');
        const size = Number(entry?.size), mtimeMs = Number(entry?.mtimeMs);
        if (!/^[a-f0-9]{48}$/.test(ref) || !accountId || !taskId || !canonicalPath || !Number.isSafeInteger(size) || size < 0 || !Number.isFinite(mtimeMs)) continue;
        entries.set(ref, { ref, accountId, taskId, canonicalPath, name: String(entry?.name || pathModule.basename(canonicalPath)), size, mtimeMs, mime: String(entry?.mime || guessMime(canonicalPath, pathModule)), createdAt: Number(entry?.createdAt) || 0 });
      }
    })();
    try { await initPromise; } catch (error) { initPromise = null; throw error; }
    return initPromise;
  }

  async function registerPaths({ accountId, taskId, filePaths }) {
    await init();
    const owner = requiredId(accountId, 'SCHEDULED_BROADCAST_ATTACHMENT_ACCOUNT_INVALID');
    const task = requiredId(taskId, 'SCHEDULED_BROADCAST_ATTACHMENT_TASK_INVALID');
    if (!Array.isArray(filePaths) || filePaths.length === 0) return Object.freeze([]);
    if (filePaths.length > limits.maxFiles) throw policyError('BROADCAST_FILE_COUNT_LIMIT', '一次最多选择 10 个附件。');
    const staged = []; let totalBytes = 0;
    for (const value of filePaths) {
      let canonicalPath, stat;
      try { canonicalPath = await fs.realpath(String(value || '')); stat = await fs.stat(canonicalPath); }
      catch { throw policyError('SCHEDULED_BROADCAST_ATTACHMENT_UNAVAILABLE', '定时附件已不可用，请重新选择。'); }
      const current = normalizeStat(stat);
      if (current.size > limits.maxFileBytes) throw policyError('BROADCAST_FILE_SIZE_LIMIT', '单个附件不能超过 512 MiB。');
      totalBytes += current.size;
      if (totalBytes > limits.maxTotalBytes) throw policyError('BROADCAST_FILE_TOTAL_LIMIT', '一次选择的附件总大小不能超过 1 GiB。');
      staged.push({ canonicalPath, name: pathModule.basename(String(value || '')) || pathModule.basename(canonicalPath), size: current.size, mtimeMs: current.mtimeMs, mime: guessMime(canonicalPath, pathModule) });
    }
    return enqueueMutation(async () => {
      const created = staged.map(item => { const ref = nextRef(); const entry = { ref, accountId: owner, taskId: task, ...item, createdAt: Date.now() }; entries.set(ref, entry); return publicRecord(entry); });
      try { await writeSnapshot(serialize()); return Object.freeze(created); }
      catch (error) { for (const record of created) entries.delete(record.ref); throw error; }
    });
  }

  async function resolve(refValue, { accountId, taskId } = {}) {
    await init();
    const ref = String(refValue || ''), owner = requiredId(accountId, 'SCHEDULED_BROADCAST_ATTACHMENT_ACCOUNT_INVALID'), task = requiredId(taskId, 'SCHEDULED_BROADCAST_ATTACHMENT_TASK_INVALID');
    if (!/^[a-f0-9]{48}$/.test(ref)) throw policyError('SCHEDULED_BROADCAST_ATTACHMENT_REF_INVALID');
    const entry = entries.get(ref);
    if (!entry || entry.accountId !== owner || entry.taskId !== task) throw policyError('SCHEDULED_BROADCAST_ATTACHMENT_REF_INVALID');
    let stat; try { stat = await fs.stat(entry.canonicalPath); } catch { throw policyError('SCHEDULED_BROADCAST_ATTACHMENT_UNAVAILABLE', '定时附件已不可用，请重新选择。'); }
    const current = normalizeStat(stat);
    if (current.size !== entry.size || current.mtimeMs !== entry.mtimeMs) throw policyError('SCHEDULED_BROADCAST_ATTACHMENT_CHANGED', '定时附件内容已发生变化，请重新选择。');
    return Object.freeze({ filePath: entry.canonicalPath, name: entry.name, size: entry.size, mime: entry.mime });
  }

  async function resolveMany(refValues, owner) {
    await init();
    const refs = Array.isArray(refValues) ? refValues.map(value => String(value || '')) : [];
    if (!refs.length || refs.length > limits.maxFiles || new Set(refs).size !== refs.length) throw policyError('SCHEDULED_BROADCAST_ATTACHMENT_REF_INVALID');
    const resolved = []; let totalBytes = 0;
    for (const ref of refs) { const item = await resolve(ref, owner); totalBytes += item.size; if (totalBytes > limits.maxTotalBytes) throw policyError('BROADCAST_FILE_TOTAL_LIMIT', '附件总大小不能超过 1 GiB。'); resolved.push(item); }
    return Object.freeze(resolved);
  }

  async function cleanupMatching(predicate) {
    await init();
    return enqueueMutation(async () => {
      const removedEntries = [];
      for (const [ref, entry] of entries) if (predicate(entry)) { removedEntries.push([ref, entry]); entries.delete(ref); }
      if (!removedEntries.length) return 0;
      try { await writeSnapshot(serialize()); return removedEntries.length; }
      catch (error) { for (const [ref, entry] of removedEntries) entries.set(ref, entry); throw error; }
    });
  }

  async function cleanupTask(accountId, taskId) {
    const owner = requiredId(accountId, 'SCHEDULED_BROADCAST_ATTACHMENT_ACCOUNT_INVALID');
    const task = requiredId(taskId, 'SCHEDULED_BROADCAST_ATTACHMENT_TASK_INVALID');
    return cleanupMatching(entry => entry.accountId === owner && entry.taskId === task);
  }
  async function cleanupAccount(accountId) {
    const owner = requiredId(accountId, 'SCHEDULED_BROADCAST_ATTACHMENT_ACCOUNT_INVALID');
    return cleanupMatching(entry => entry.accountId === owner);
  }
  function listTask(accountId, taskId) {
    const owner = String(accountId || ''), task = String(taskId || '');
    return Object.freeze([...entries.values()].filter(entry => entry.accountId === owner && entry.taskId === task).map(publicRecord));
  }
  function countAccount(accountId) { const owner = String(accountId || ''); return [...entries.values()].filter(entry => entry.accountId === owner).length; }

  return Object.freeze({ limits, init, registerPaths, resolve, resolveMany, cleanupTask, cleanupAccount, listTask, countAccount, size: () => entries.size });
}

module.exports = { DEFAULT_LIMITS, createScheduledBroadcastAttachmentStore };

import { errorMessage as shellError } from '../model.mjs';
import { errorCode, errorMessage as broadcastError } from './broadcast-status.mjs';
import { DEFAULT_POLICY, policyOf, chatPolicyOf, translationOf, translationError } from './translation.mjs';
import { exclusionIds } from './broadcast-presets.mjs';

const own = (value, key) => Object.hasOwn(value, key);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const text = (value) => typeof value === 'string';
const invalid = () => { throw 'ADVANCED_RESPONSE_INVALID'; };
const states = new Set(['scheduled', 'queued', 'starting', 'running', 'paused', 'stopping', 'completed', 'stopped', 'failed']);
const totals = ['total', 'ok', 'fail', 'uncertain', 'pending'];

function owner(value, accountId) {
  if (!object(value) || value.accountId !== accountId) invalid();
}

export function exportResult(value, accountId, revision = undefined) {
  owner(value, accountId);
  if (typeof value.saved !== 'boolean' || (revision !== undefined && value.revision !== revision)
    || (revision !== undefined && !count(value.rowCount))
    || (own(value, 'rowCount') && !count(value.rowCount))) invalid();
  return { accountId, saved: value.saved, rowCount: value.rowCount, revision: value.revision };
}

export function historyOf(value, accountId) {
  owner(value, accountId);
  if (!count(value.revision) || !object(value.summary) || !Array.isArray(value.rows)
    || !['jobs', ...totals].every((key) => count(value.summary[key]))) invalid();
  const ids = new Set();
  const rows = value.rows.map((row) => {
    if (!object(row) || !text(row.jobId) || !row.jobId || ids.has(row.jobId) || !states.has(row.state)
      || ![...totals, 'createdAt', 'attachments', 'messageLength'].every((key) => count(row[key]))
      || (row.finishedAt !== null && !count(row.finishedAt))
      || row.ok + row.fail + row.uncertain + row.pending !== row.total) invalid();
    ids.add(row.jobId);
    return Object.fromEntries(['jobId', 'createdAt', 'finishedAt', ...totals, 'attachments', 'messageLength', 'state']
      .map((key) => [key, row[key]]));
  });
  if (value.summary.jobs !== rows.length
    || totals.some((key) => value.summary[key] !== rows.reduce((sum, row) => sum + row[key], 0))) invalid();
  return { accountId, revision: value.revision,
    summary: Object.fromEntries(['jobs', ...totals].map((key) => [key, value.summary[key]])), rows };
}

function knownObject(value, keys) {
  if (!object(value) || Object.keys(value).some((key) => !keys.includes(key))) invalid();
}

// Preserve presence: an absent key means keep existing settings; [] / {} means
// replace with an empty collection. Never manufacture defaults for missing keys.
export function backupDataOf(value) {
  knownObject(value, ['presets', 'translation']);
  const data = {};
  if (own(value, 'presets')) {
    const presets = value.presets;
    knownObject(presets, ['messages', 'audiences', 'excludedContactIds', 'excludedGroupIds']);
    if (!Object.keys(presets).length) invalid();
    data.presets = {};
    for (const kind of ['messages', 'audiences']) {
      if (!own(presets, kind)) continue;
      if (!Array.isArray(presets[kind])) invalid();
      data.presets[kind] = presets[kind].map((entry) => {
        knownObject(entry, kind === 'messages' ? ['name', 'message'] : ['name', 'recipientIds']);
        if (!text(entry.name)) invalid();
        if (kind === 'messages') {
          if (!text(entry.message)) invalid();
          return { name: entry.name, message: entry.message };
        }
        if (!Array.isArray(entry.recipientIds) || !entry.recipientIds.every(text)) invalid();
        return { name: entry.name, recipientIds: [...entry.recipientIds] };
      });
    }
    for (const key of ['excludedContactIds', 'excludedGroupIds']) {
      if (!own(presets, key)) continue;
      try { data.presets[key] = exclusionIds(presets[key]); } catch { invalid(); }
    }
  }
  if (own(value, 'translation')) {
    const translation = value.translation;
    knownObject(translation, ['global', 'chats']);
    if (!Object.keys(translation).length) invalid();
    data.translation = {};
    try {
      if (own(translation, 'global')) {
        knownObject(translation.global, Object.keys(DEFAULT_POLICY));
        if (Object.keys(translation.global).length !== Object.keys(DEFAULT_POLICY).length) invalid();
        data.translation.global = policyOf(translation.global);
      }
      if (own(translation, 'chats')) {
        if (!object(translation.chats)) invalid();
        data.translation.chats = Object.fromEntries(Object.entries(translation.chats).map(([id, policy]) => [id, chatPolicyOf(policy)]));
      }
    } catch { invalid(); }
  }
  return data;
}

export function backupPreviewOf(value, accountId) {
  owner(value, accountId);
  const backup = value.backup;
  if (!count(value.presetRevision) || !count(value.translationRevision) || !object(backup) || !count(backup.version)
    || !object(backup.account) || !text(backup.account.name) || !text(backup.account.type)
    || ![backup.reportedUnsupported, backup.ignoredKeys].every((list) => Array.isArray(list) && list.every(text))) invalid();
  return { accountId, presetRevision: value.presetRevision, translationRevision: value.translationRevision,
    backup: { version: backup.version, account: { name: backup.account.name, type: backup.account.type },
      data: backupDataOf(backup.data), reportedUnsupported: [...backup.reportedUnsupported], ignoredKeys: [...backup.ignoredKeys] } };
}

export function previewCounts(data) {
  return [['常用消息', data.presets, 'messages'], ['自定义标签', data.presets, 'audiences'],
    ['联系人排除项', data.presets, 'excludedContactIds'], ['群组排除项', data.presets, 'excludedGroupIds'],
    ['全局翻译', data.translation, 'global'], ['单聊翻译', data.translation, 'chats']].map(([label, section, key]) => {
    const present = Boolean(section && own(section, key));
    const size = !present ? null : key === 'global' ? 1 : key === 'chats' ? Object.keys(section[key]).length : section[key].length;
    return { label, size, action: !present ? '保持现有' : size === 0 ? '清空现有' : '替换现有' };
  });
}

export function restoreResult(value, accountId, requested) {
  owner(value, accountId);
  const result = { accountId };
  for (const kind of ['presets', 'translation']) {
    const section = value[kind];
    if (!object(section) || !['restored', 'unchanged', 'failed', 'notAttempted'].includes(section.status)
      || !count(section.revision) || !(section.code === null || (text(section.code) && /^[A-Z][A-Z0-9_]{0,100}$/.test(section.code)))) invalid();
    result[kind] = { status: section.status, code: section.code, revision: section.revision };
  }
  const account = value.snapshot?.accounts?.find((item) => item.id === accountId);
  if (!account?.translation) invalid();
  try {
    const translation = translationOf(account);
    if (translation.revision !== result.translation.revision) invalid();
    result.snapshot = { accounts: [{ id: accountId, translation }] };
  } catch { invalid(); }
  result.remaining = Object.fromEntries(Object.entries(requested).filter(([kind]) =>
    ['failed', 'notAttempted'].includes(result[kind].status)));
  return result;
}

const backupLabels = {
  savedMessages: '常用消息', savedLists: '自定义标签', translationGlobal: '全局翻译', translationChats: '单聊翻译',
  broadcastExclude: '群发排除项', broadcastExcludeContacts: '联系人排除项', broadcastExcludeGroups: '群组排除项',
  broadcastGroups: '群发分组', savedGroups: '保存的群组', groupLinks: '群链接',
  gtAutoCfg: '群工具自动配置', gtCmdCfg: '群工具命令配置', gtCmdNames: '群工具命令名称',
  sendHistory: '发送历史', scheduleTasks: '定时任务', broadcastJobSchedules: '群发定时任务',
};
export const backupKeyLabel = (key) => Object.hasOwn(backupLabels, key) ? backupLabels[key] : key;

export function advancedError(error) {
  const code = errorCode(error);
  if (code === 'ADVANCED_RESPONSE_INVALID') return '返回的资料无法核对，请重新读取后重试。';
  if (code === 'BROADCAST_UNSUPPORTED') return '当前平台暂不支持读取联系人，请使用已支持的平台账号。';
  if (code === 'BROADCAST_EXPORT_EMPTY') return '当前没有可导出的记录。';
  if (code === 'BROADCAST_EXPORT_FAILED') return 'CSV 未能保存，请重试。';
  if (code === 'BROADCAST_STATE') return '任务记录已变化，请重新读取后导出。';
  if (code === 'BROADCAST_PRESET_CONFLICT' || code === 'TRANSLATION_SETTINGS_CONFLICT') {
    return '当前设置已变化，请重新选择备份文件并核对后恢复。';
  }
  if (code.startsWith('BROADCAST_')) return broadcastError(code);
  if (code.startsWith('TRANSLATION_')) return translationError(code);
  return shellError(code);
}

export const steps = Object.freeze(['content', 'audience', 'settings', 'review']);
export const terminal = new Set(['completed', 'stopped', 'failed']);
export const executing = new Set(['starting', 'running', 'paused', 'stopping']);
export const pending = new Set(['scheduled', 'queued']);
export const attachmentLimits = Object.freeze({ count: 10, fileBytes: 512 * 1024 * 1024, totalBytes: 1024 * 1024 * 1024 });
export const audienceSourceKinds = Object.freeze({ paste: 'paste', 'group-members': 'groups', label: 'label' });

export function emptyRecipientSources() {
  return Object.fromEntries(['paste', 'groups', 'label'].map((kind) => [kind,
    { selection: kind === 'groups' ? [] : '', revision: 0, verifiedRevision: null, recipientIds: [], summary: null }]));
}

export function recipientSourceIssue(kind, source, catalog) {
  if (!source) return 'BROADCAST_SOURCE_EMPTY';
  const selected = source.selection;
  if (kind === 'paste') {
    if (typeof selected !== 'string' || !selected.trim()) return 'BROADCAST_PASTE_UNVERIFIED';
    return new TextEncoder().encode(selected).length > 128 * 1024 ? 'BROADCAST_IMPORT_LIMIT' : null;
  }
  if (kind === 'groups') {
    if (catalog?.capabilities.groupMembers !== true) return 'BROADCAST_SOURCE_UNAVAILABLE';
    if (!Array.isArray(selected) || !selected.length) return 'BROADCAST_SOURCE_EMPTY';
    if (selected.length > 20) return 'BROADCAST_SOURCE_LIMIT';
    return selected.some((id) => !catalog.chats.some((chat) => chat.id === id && chat.kind === 'group'))
      ? 'BROADCAST_SOURCE_STALE' : null;
  }
  if (!Array.isArray(catalog?.labels)) return 'BROADCAST_SOURCE_UNAVAILABLE';
  if (!selected) return 'BROADCAST_SOURCE_EMPTY';
  return catalog.labels.some((label) => label.id === selected) ? null : 'BROADCAST_SOURCE_STALE';
}

export function normalizeAttachments(value = []) {
  if (!Array.isArray(value)) throw 'BROADCAST_ATTACHMENT_INVALID';
  if (value.length > attachmentLimits.count) throw 'BROADCAST_FILE_COUNT_LIMIT';
  const ids = new Set();
  let total = 0;
  return value.map((file) => {
    if (!file || typeof file.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(file.id) || ids.has(file.id)
      || typeof file.name !== 'string' || !file.name.trim() || file.name.length > 512 || /[\x00-\x1f\x7f/\\]/.test(file.name)
      || !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.mime !== 'string' || file.mime.length > 128
      || !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(file.mime)
      || !['image', 'video', 'audio', 'document'].includes(file.kind)) throw 'BROADCAST_ATTACHMENT_INVALID';
    if (file.size > attachmentLimits.fileBytes) throw 'BROADCAST_FILE_SIZE_LIMIT';
    total += file.size;
    if (total > attachmentLimits.totalBytes) throw 'BROADCAST_FILE_TOTAL_LIMIT';
    ids.add(file.id);
    return { id: file.id, name: file.name, size: file.size, mime: file.mime, kind: file.kind };
  });
}

export function localSchedule(now = Date.now()) {
  const date = new Date(now + 30 * 60_000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function emptyDraft(accountId, now = Date.now()) {
  return { accountId, recipientIds: [], audienceMode: 'custom', manualRecipientIds: [], importedRecipientIds: [],
    importFileName: '', importSummary: null, sources: emptyRecipientSources(),
    exclusionBaseIds: null, excludedContactIds: [], excludedGroupIds: [],
    message: '', vcardIds: [], attachments: [], tagAll: false,
    intervalMin: 5, intervalMax: 10, scheduleEnabled: false, scheduleTime: localSchedule(now) };
}

export function normalizeCatalog(value, accountId) {
  if (!value || value.accountId !== accountId || !Array.isArray(value.chats)) throw 'BROADCAST_CATALOG_INVALID';
  const seen = new Set();
  const chats = value.chats.map((chat) => {
    if (!chat || typeof chat.id !== 'string' || !chat.id || seen.has(chat.id)
      || !['contact', 'group'].includes(chat.kind)) throw 'BROADCAST_CATALOG_INVALID';
    seen.add(chat.id);
    return { id: chat.id, name: typeof chat.name === 'string' ? chat.name : '',
      realName: typeof chat.realName === 'string' ? chat.realName : '', kind: chat.kind };
  });
  if (value.ready && (typeof value.catalogId !== 'string' || !value.catalogId)) throw 'BROADCAST_CATALOG_INVALID';
  let labels = value.labels ?? null;
  if (labels !== null) {
    if (!Array.isArray(labels)) throw 'BROADCAST_CATALOG_INVALID';
    const seenLabels = new Set();
    labels = labels.map((label) => {
      if (!label || typeof label.id !== 'string' || !label.id || seenLabels.has(label.id)
        || typeof label.name !== 'string') throw 'BROADCAST_CATALOG_INVALID';
      seenLabels.add(label.id); return { id: label.id, name: label.name };
    });
  }
  return { ...value, chats, labels, capabilities: { ...value.capabilities } };
}

export function normalizeResolvedRecipients(value, accountId, allowGroups = false, allowEmpty = false) {
  if (!value || value.accountId !== accountId || !Array.isArray(value.recipientIds) || value.recipientIds.length > 2000
    || new Set(value.recipientIds).size !== value.recipientIds.length) throw 'BROADCAST_IMPORT_INVALID';
  const summary = {};
  for (const key of ['total', 'accepted', 'duplicates', 'invalid', 'unresolved', 'skipped']) {
    const count = value.summary?.[key];
    if (!Number.isSafeInteger(count) || count < 0) throw 'BROADCAST_IMPORT_INVALID';
    summary[key] = count;
  }
  if (summary.accepted !== value.recipientIds.length
    || summary.total !== summary.accepted + summary.duplicates + summary.invalid + summary.unresolved + summary.skipped) {
    throw 'BROADCAST_IMPORT_INVALID';
  }
  let catalog;
  try { catalog = normalizeCatalog(value.catalog, accountId); } catch { throw 'BROADCAST_IMPORT_INVALID'; }
  const contacts = new Set(catalog.chats.filter((chat) => allowGroups || chat.kind === 'contact').map((chat) => chat.id));
  if (!catalog.ready || value.recipientIds.some((id) => typeof id !== 'string' || !contacts.has(id))) throw 'BROADCAST_IMPORT_INVALID';
  if (!allowEmpty && !value.recipientIds.length) throw 'BROADCAST_IMPORT_EMPTY';
  return { accountId, catalog, recipientIds: value.recipientIds.slice(), summary };
}

export function normalizeImportedContacts(value, accountId) {
  if (typeof value?.fileName !== 'string' || !value.fileName.trim() || value.fileName.length > 512
    || /[\x00-\x1f\x7f/\\]/.test(value.fileName)) throw 'BROADCAST_IMPORT_INVALID';
  return { ...normalizeResolvedRecipients(value, accountId), fileName: value.fileName };
}

export function importSummaryText(summary, action = '已导入', noun = '联系人') {
  if (!summary) return action === '已导入' ? '尚未导入联系人' : '请先核验号码';
  return [`${action} ${summary.accepted} 个${noun}`, summary.duplicates && `重复 ${summary.duplicates} 个`,
    summary.invalid && `格式无效 ${summary.invalid} 个`, summary.unresolved && `未核验 ${summary.unresolved} 个`,
    summary.skipped && `已跳过 ${summary.skipped} 个`].filter(Boolean).join('，');
}

export function matchingChats(chats, query = '', kind = null) {
  const search = query.trim().toLocaleLowerCase();
  return chats.filter((chat) => (!kind || chat.kind === kind)
    && (!search || `${chat.name} ${chat.realName} ${chat.id}`.toLocaleLowerCase().includes(search)));
}

export function draftRecipients(draft, catalog) {
  if (!catalog?.ready || catalog.accountId !== draft.accountId) throw 'BROADCAST_ACCOUNT_NOT_READY';
  const sourceKind = audienceSourceKinds[draft.audienceMode];
  if (sourceKind) {
    const source = draft.sources?.[sourceKind];
    const issue = recipientSourceIssue(sourceKind, source, catalog);
    if (issue) throw issue;
    if (!Number.isSafeInteger(source.verifiedRevision) || source.verifiedRevision !== source.revision) {
      throw sourceKind === 'paste' ? 'BROADCAST_PASTE_UNVERIFIED' : 'BROADCAST_SOURCE_UNVERIFIED';
    }
  }
  const recipientIds = [...new Set(draft.recipientIds)];
  const targets = recipientIds.map((id) => catalog.chats.find((chat) => chat.id === id));
  if (!targets.length) throw 'BROADCAST_AUDIENCE_EMPTY';
  if (targets.some((target) => !target)) throw 'BROADCAST_CATALOG_STALE';
  return recipientIds;
}

export function draftPayload(draft, catalog, now = Date.now()) {
  const recipientIds = draftRecipients(draft, catalog);
  if (!catalog.capabilities.text) throw 'BROADCAST_UNSUPPORTED';
  const targets = recipientIds.map((id) => catalog.chats.find((chat) => chat.id === id));
  const message = String(draft.message || '');
  const vcardIds = [...new Set(draft.vcardIds)];
  const attachments = normalizeAttachments(draft.attachments);
  if (!message.trim() && !vcardIds.length && !attachments.length) throw 'BROADCAST_CONTENT_EMPTY';
  if (attachments.length && !catalog.capabilities.attachments) throw 'BROADCAST_ATTACHMENTS_UNAVAILABLE';
  if (attachments.length && draft.tagAll) throw 'BROADCAST_ATTACHMENTS_TAG_ALL';
  if (vcardIds.length && !catalog.capabilities.vcards) throw 'BROADCAST_VCARDS_UNAVAILABLE';
  if (vcardIds.some((id) => !catalog.chats.some((chat) => chat.id === id && chat.kind === 'contact'))) {
    throw 'BROADCAST_CATALOG_STALE';
  }
  if (draft.tagAll && !catalog.capabilities.tagAll) throw 'BROADCAST_TAG_ALL_UNAVAILABLE';
  if (draft.tagAll && !message.trim()) throw 'BROADCAST_TAG_ALL_REQUIRES_TEXT';
  if (/%nc/i.test(message) && targets.some((target) => !target.name.trim())) throw 'BROADCAST_NAME_MISSING';
  if (/%nr/i.test(message) && targets.some((target) => !(target.realName || target.name).trim())) throw 'BROADCAST_NAME_MISSING';
  const intervalMin = Number(draft.intervalMin);
  const intervalMax = Number(draft.intervalMax);
  if (!Number.isInteger(intervalMin) || !Number.isInteger(intervalMax)
    || intervalMin < 5 || intervalMax > 60 || intervalMax < intervalMin) throw 'BROADCAST_INTERVAL_INVALID';
  const scheduledAt = draft.scheduleEnabled ? new Date(draft.scheduleTime).getTime() : null;
  if (draft.scheduleEnabled && !catalog.capabilities.scheduled) throw 'BROADCAST_SCHEDULE_UNAVAILABLE';
  if (draft.scheduleEnabled && (!Number.isFinite(scheduledAt) || scheduledAt <= now)) throw 'BROADCAST_SCHEDULE_INVALID';
  return { accountId: draft.accountId, catalogId: catalog.catalogId, recipientIds, message, vcardIds,
    attachmentIds: attachments.map((file) => file.id),
    tagAll: Boolean(draft.tagAll), intervalMin, intervalMax, scheduledAt };
}

// A new native context does not change the user's intent. Retry the same UUID after an
// uncertain create response; only editing semantic content starts a different request.
export function submissionFor(payload, previous, uuid) {
  const { catalogId: _catalog, ...intent } = payload;
  const fingerprint = JSON.stringify(intent);
  if (previous?.fingerprint === fingerprint) return previous;
  const id = uuid();
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw 'BROADCAST_ID_UNAVAILABLE';
  }
  return { id, fingerprint };
}

export function previewMessage(message, target = {}, now = Date.now()) {
  const hour = new Date(now).getHours();
  const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
  // Preview the first variant deterministically; the native sender chooses per target.
  return String(message).replace(/\{([^{}|]+(?:\|[^{}|]+)+)\}/g, (_all, choices) => choices.split('|')[0].trim())
    .replace(/%nc/gi, target.name || '（未提供姓名）')
    .replace(/%nr/gi, target.realName || target.name || '（未提供昵称）')
    .replace(/%sa/gi, greeting);
}

export function currentJob(jobs, accountId) {
  const visible = jobs.filter((job) => job.accountId === accountId && !job.dismissed);
  return visible.find((job) => executing.has(job.state))
    || visible.filter((job) => pending.has(job.state)).sort((a, b) => (a.scheduledAt || a.createdAt) - (b.scheduledAt || b.createdAt))[0]
    || visible.sort((a, b) => b.createdAt - a.createdAt)[0] || null;
}

export function jobSummary(jobs) {
  const visible = jobs.filter((job) => !job.dismissed);
  return { active: visible.filter((job) => !terminal.has(job.state)).length,
    running: visible.filter((job) => ['starting', 'running', 'stopping'].includes(job.state) && !job.reviewRequired && !job.storageBlocked).length,
    pending: visible.filter((job) => pending.has(job.state)).length,
    issues: visible.filter((job) => job.state === 'failed' || job.fail || job.uncertain || job.reviewRequired || job.storageBlocked).length };
}

export function resultRows(job) {
  const rows = (job.results || []).filter((result) => result.outcome?.status !== 'confirmed').map((result) => {
    const target = job.targets?.[result.index];
    return { index: result.index, name: target?.name || `对象 ${Number(result.index) + 1}`,
      status: result.outcome?.status, code: result.outcome?.code || 'BROADCAST_UNKNOWN' };
  });
  if (job.lastIssue && !rows.some((row) => row.code === job.lastIssue)) {
    rows.unshift({ index: null, name: '任务', status: job.uncertain ? 'uncertain' : 'notSubmitted', code: job.lastIssue });
  }
  return rows;
}

export function hasExportableIssues(job) {
  return Boolean(job && (job.storageBlocked || job.lastIssue
    || job.results?.some((result) => ['notSubmitted', 'uncertain'].includes(result.outcome?.status))));
}

export function jobLabel(job) {
  if (job.storageBlocked) return '存储故障待处理';
  if (job.reviewRequired) return '中断待核对';
  return { scheduled: '已定时', queued: '排队中', starting: '准备中', running: '发送中', paused: '已暂停',
    stopping: '停止中', completed: '已完成', stopped: '已停止', failed: '有异常' }[job.state] || '状态未知';
}

export function formatTime(value) {
  return Number.isFinite(value) && value > 0 ? new Date(value).toLocaleString() : '立即发送';
}

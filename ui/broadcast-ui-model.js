(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastUiModel = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function listValue(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function stableId(prefix, text) {
    let hash = 2166136261;
    for (const char of String(text || '')) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return `${prefix}-${(hash >>> 0).toString(16)}`;
  }

  function normalizeMessages(value) {
    const output = [];
    const positions = new Map();
    for (const record of listValue(value)) {
      if (!record || typeof record !== 'object') continue;
      const name = String(record.name || '').trim().slice(0, 80);
      const msg = String(record.msg || '');
      if (!name || !msg.trim()) continue;
      const item = { name, msg };
      if (positions.has(name)) output[positions.get(name)] = item;
      else { positions.set(name, output.length); output.push(item); }
    }
    return output;
  }

  function upsertMessage(value, item) {
    const messages = normalizeMessages(value);
    const name = String(item?.name || '').trim().slice(0, 80);
    const msg = String(item?.msg || '');
    if (!name || !msg.trim()) throw new TypeError('message template requires name and content');
    const index = messages.findIndex(record => record.name === name);
    const next = { name, msg };
    if (index >= 0) messages[index] = next;
    else messages.push(next);
    return messages;
  }

  function removeMessage(value, name) {
    const wanted = String(name || '').trim();
    return normalizeMessages(value).filter(record => record.name !== wanted);
  }

  function normalizeGroupTags(value) {
    const output = [];
    const positions = new Map();
    for (const [index, record] of listValue(value).entries()) {
      if (!record || typeof record !== 'object') continue;
      const name = String(record.name || '').trim().slice(0, 80);
      const chatIds = [...new Set((Array.isArray(record.chatIds) ? record.chatIds : []).map(id => String(id || '').trim()).filter(Boolean))];
      if (!name || !chatIds.length) continue;
      const id = String(record.id || '').trim() || stableId('bg-legacy', `${index}:${name}:${chatIds.join('|')}`);
      const item = {
        id,
        name,
        chatIds,
        createdAt: Number(record.createdAt) || 0,
        updatedAt: Number(record.updatedAt) || 0,
      };
      const key = name;
      if (positions.has(key)) output[positions.get(key)] = item;
      else { positions.set(key, output.length); output.push(item); }
    }
    return output;
  }

  function upsertGroupTag(value, item, now = Date.now()) {
    const groups = normalizeGroupTags(value);
    const name = String(item?.name || '').trim().slice(0, 80);
    const chatIds = [...new Set((Array.isArray(item?.chatIds) ? item.chatIds : []).map(id => String(id || '').trim()).filter(Boolean))];
    if (!name || !chatIds.length) throw new TypeError('group tag requires name and chatIds');
    const index = groups.findIndex(group => group.name === name);
    const previous = index >= 0 ? groups[index] : null;
    const next = {
      id: previous?.id || String(item?.id || '').trim() || stableId('bg', `${now}:${name}:${chatIds.join('|')}`),
      name,
      chatIds,
      createdAt: previous?.createdAt || Number(item?.createdAt) || now,
      updatedAt: now,
    };
    if (index >= 0) groups[index] = next;
    else groups.push(next);
    return { groups, tag: next };
  }

  function removeGroupTag(value, id) {
    const wanted = String(id || '');
    return normalizeGroupTags(value).filter(group => group.id !== wanted);
  }

  function isGroup(chat) {
    return chat?.isGroup === true || chat?.type === '群组' || chat?.type === 'group';
  }

  function resolveAudience({ mode = 'custom', chats = [], selectedIds = [], excludedIds = [] } = {}) {
    const selected = new Set([...selectedIds].map(String));
    const excluded = new Set([...excludedIds].map(String));
    let base;
    if (mode === 'all' || mode === 'exclude-contacts' || mode === 'exclude-groups') base = chats;
    else if (mode === 'all-contacts') base = chats.filter(chat => !isGroup(chat));
    else if (mode === 'all-groups') base = chats.filter(isGroup);
    else base = chats.filter(chat => selected.has(String(chat?.id || '')));
    return base.filter(chat => !excluded.has(String(chat?.id || '')));
  }

  async function persistBeforeCommit(nextValue, persist) {
    if (typeof persist !== 'function') return { ok: false, error: new TypeError('persist callback required') };
    try {
      const result = await persist(nextValue);
      if (result === false) return { ok: false, error: new Error('PERSIST_REJECTED') };
      return { ok: true, value: nextValue };
    } catch (error) {
      return { ok: false, error };
    }
  }

  return Object.freeze({
    listValue,
    normalizeMessages,
    upsertMessage,
    removeMessage,
    normalizeGroupTags,
    upsertGroupTag,
    removeGroupTag,
    resolveAudience,
    persistBeforeCommit,
  });
});

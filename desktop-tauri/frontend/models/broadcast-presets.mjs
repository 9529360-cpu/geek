const controls = /[\u0000-\u001f\u007f-\u009f]/;
const messageControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

export function exclusionIds(value) {
  if (!Array.isArray(value) || value.length > 2000 || new Set(value).size !== value.length
    || value.some((id) => typeof id !== 'string' || !id || id.length > 500 || /\s/.test(id) || controls.test(id))) {
    throw 'BROADCAST_PRESET_INVALID';
  }
  return value.slice();
}

export function exclusionsOf(value) {
  return { excludedContactIds: exclusionIds(value.excludedContactIds), excludedGroupIds: exclusionIds(value.excludedGroupIds) };
}

export function exclusionFingerprint(value) {
  return JSON.stringify([value.excludedContactIds, value.excludedGroupIds]);
}

export function presetName(value) {
  if (typeof value !== 'string' || !value.trim() || controls.test(value)) throw 'BROADCAST_PRESET_INVALID';
  const name = value.trim();
  if (name.length > 80) throw 'BROADCAST_PRESET_LIMIT';
  return name;
}

export function presetMessage(value) {
  if (typeof value !== 'string' || !value.trim() || messageControls.test(value)) throw 'BROADCAST_PRESET_INVALID';
  if (value.length > 10_000 || new TextEncoder().encode(value).length > 32_768) throw 'BROADCAST_PRESET_LIMIT';
  return value;
}

export function normalizePresets(value, accountId, requireExclusions = false) {
  if (!value || value.accountId !== accountId || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !Array.isArray(value.messages) || !Array.isArray(value.audiences)
    || value.messages.length > 100 || value.audiences.length > 100) throw 'BROADCAST_PRESET_INVALID';
  const rows = (items, kind) => {
    const seen = new Set();
    return items.map((item) => {
      if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 128 || controls.test(item.id)
        || seen.has(item.id) || item.name !== presetName(item.name)) throw 'BROADCAST_PRESET_INVALID';
      seen.add(item.id);
      if (kind === 'message') return { id: item.id, name: item.name, message: presetMessage(item.message) };
      if (!Array.isArray(item.recipientIds) || !item.recipientIds.length || item.recipientIds.length > 2000
        || new Set(item.recipientIds).size !== item.recipientIds.length
        || item.recipientIds.some((id) => typeof id !== 'string' || !id || id.length > 500 || /\s/.test(id) || controls.test(id))) {
        throw 'BROADCAST_PRESET_INVALID';
      }
      return { id: item.id, name: item.name, recipientIds: item.recipientIds.slice() };
    });
  };
  // Older native snapshots have no durable exclusions; a partially present or
  // null pair is never interpreted as an empty saved deny list.
  const exclusions = !requireExclusions && !Object.hasOwn(value, 'excludedContactIds') && !Object.hasOwn(value, 'excludedGroupIds')
    ? { excludedContactIds: [], excludedGroupIds: [] } : exclusionsOf(value);
  return { accountId, revision: value.revision, messages: rows(value.messages, 'message'), audiences: rows(value.audiences, 'audience'),
    ...exclusions };
}

// Changes to an audience source also matter when its verified result is still empty.
export function audienceDraftFingerprint(draft) {
  return JSON.stringify([draft.audienceMode, draft.recipientIds, draft.manualRecipientIds, draft.importedRecipientIds,
    draft.sources, draft.exclusionBaseIds, draft.excludedContactIds, draft.excludedGroupIds]);
}

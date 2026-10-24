// In-memory native boundary for UI behavior tests. Production state stays in Rust.
export function presetPort(seed = {}) {
  const snapshots = new Map(Object.entries(structuredClone(seed)));
  let sequence = 0;
  const read = (accountId) => ({ excludedContactIds: [], excludedGroupIds: [], ...structuredClone(snapshots.get(accountId)
    || { accountId, revision: 0, messages: [], audiences: [] }) });
  return {
    read,
    publish(value) { snapshots.set(value.accountId, structuredClone(value)); },
    async invoke(name, args) {
      if (name === 'presets') return read(args);
      if (!['saveMessage', 'saveAudience', 'saveExclusions', 'deletePreset'].includes(name)) return undefined;
      const current = read(args.accountId);
      if (current.revision !== args.expectedRevision) throw 'BROADCAST_PRESET_CONFLICT';
      if (name === 'saveMessage') {
        const item = current.messages.find((item) => item.name === args.name);
        if (item?.message === args.message) return current;
        if (item) item.message = args.message;
        else current.messages.push({ id: `message-${++sequence}`, name: args.name, message: args.message });
      } else if (name === 'saveAudience') {
        current.audiences.push({ id: `audience-${++sequence}`, name: args.name, recipientIds: args.recipientIds.slice() });
      } else if (name === 'saveExclusions') {
        if (JSON.stringify(current.excludedContactIds) === JSON.stringify(args.excludedContactIds)
          && JSON.stringify(current.excludedGroupIds) === JSON.stringify(args.excludedGroupIds)) return current;
        current.excludedContactIds = args.excludedContactIds.slice();
        current.excludedGroupIds = args.excludedGroupIds.slice();
      } else {
        const key = args.kind === 'message' ? 'messages' : 'audiences';
        if (!current[key].some((item) => item.id === args.id)) throw 'BROADCAST_PRESET_UNKNOWN';
        current[key] = current[key].filter((item) => item.id !== args.id);
      }
      current.revision += 1;
      snapshots.set(args.accountId, structuredClone(current));
      return current;
    },
  };
}

// One native-selected file at a time. No URLs, paths, native IPC or file picking.
// An unresolved platform upload keeps its slot until the actual Promise settles.
function createBroadcastAttachmentBuffer() {
  const chunkBytes = 512 * 1024;
  let slot = null;
  const matches = (attemptId, index) => slot?.attemptId === attemptId && slot.index === index;
  return Object.freeze({
    start(attemptId, index, metadata) {
      if (slot || !metadata || !Number.isSafeInteger(metadata.size)
          || metadata.size < 0 || metadata.size > 512 * 1024 * 1024) return false;
      slot = { attemptId, index, metadata, received: 0, parts: [], file: null, busy: false };
      return true;
    },
    chunk(attemptId, index, offset, data) {
      if (!matches(attemptId, index) || slot.busy || slot.file || offset !== slot.received
          || typeof data !== 'string' || !data.length || data.length > Math.ceil(chunkBytes / 3) * 4
          || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return false;
      let binary;
      try { binary = atob(data); } catch { return false; }
      if (!binary.length || binary.length > chunkBytes || btoa(binary) !== data
          || slot.received + binary.length > slot.metadata.size) return false;
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      slot.parts.push(bytes);
      slot.received += bytes.length;
      return true;
    },
    seal(attemptId, index) {
      if (!matches(attemptId, index) || slot.busy || slot.file || slot.received !== slot.metadata.size) return false;
      slot.file = new File(slot.parts, slot.metadata.name, { type: slot.metadata.mime, lastModified: 0 });
      slot.parts = [];
      return slot.file.size === slot.metadata.size;
    },
    take(attemptId, index) {
      if (!matches(attemptId, index) || slot.busy || !slot.file) return null;
      const owned = slot;
      owned.busy = true;
      return { file: owned.file, release() { if (slot === owned) slot = null; } };
    },
    discard(attemptId) {
      if (slot?.attemptId === attemptId && !slot.busy) slot = null;
    },
    clear() { if (!slot?.busy) slot = null; },
  });
}

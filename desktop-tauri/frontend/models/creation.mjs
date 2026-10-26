// Reject malformed input instead of silently truncating it into a different count.
export function batchCount(value) {
  const text = String(value).trim();
  if (!/^(?:[1-9]|10)$/.test(text)) throw 'BATCH_INVALID';
  return Number(text);
}

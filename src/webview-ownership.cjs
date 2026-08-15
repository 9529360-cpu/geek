'use strict';

function createOwnershipRegistry({ maxAgeMs = Number.POSITIVE_INFINITY } = {}) {
  const entries = new Map();

  function register({ guestId, accountId, partition, token, senderId, now = Date.now() }) {
    const id = Number(guestId);
    if (!Number.isInteger(id) || id <= 0) throw new Error('guestId不合法');
    if (!accountId || !partition || !/^[a-f0-9]{32,128}$/i.test(String(token || ''))) throw new Error('WebView登记参数不合法');
    entries.set(id, { accountId: String(accountId), partition: String(partition), token: String(token), senderId: Number(senderId), registeredAt: Number(now) });
    return true;
  }

  function authorize({ guestId, accountId, partition, token, senderId, now = Date.now() }) {
    const entry = entries.get(Number(guestId));
    if (!entry) return false;
    if (Number(now) - entry.registeredAt > maxAgeMs) { entries.delete(Number(guestId)); return false; }
    return entry.accountId === String(accountId)
      && entry.partition === String(partition)
      && entry.token === String(token)
      && entry.senderId === Number(senderId);
  }

  function remove(guestId) { entries.delete(Number(guestId)); }
  function clear() { entries.clear(); }
  return Object.freeze({ register, authorize, remove, clear });
}

module.exports = { createOwnershipRegistry };

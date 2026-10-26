const NOTIFY = new Set(['whatsapp', 'whatsapp-pure', 'telegram-k', 'telegram-z']);

export function badgeText(count) {
  if (!Number.isSafeInteger(count) || count <= 0) return '';
  return count > 99 ? '99+' : String(count);
}

function familyKey(platformId) {
  if (platformId === 'whatsapp' || platformId === 'whatsapp-pure') return 'whatsapp';
  if (platformId === 'telegram-k' || platformId === 'telegram-z') return 'telegram';
  return '';
}

// The sentence is the old shell copy: a count, never chat text.
export function describeNotice(account, count) {
  const family = familyKey(account?.platformId);
  if (!family || !NOTIFY.has(account.platformId)) return null;
  if (!Number.isSafeInteger(count) || count <= 0 || count > 9999) return null;
  const name = typeof account.name === 'string' && account.name.trim() ? account.name : family;
  return { title: name, body: `${family.toUpperCase()} 收到 ${count} 条新消息` };
}

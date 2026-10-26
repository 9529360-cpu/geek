// Original contact-notes semantics: bounded text fields, follow statuses and the
// 2000-entry store, normalized exactly like ui/contact-notes.js.
export const MAX_NOTE_LENGTH = 2000;
export const MAX_ENTRIES = 2000;
export const FOLLOW_STATUSES = Object.freeze(['', 'new', 'following', 'quoting', 'won', 'paused', 'lost']);
export const FOLLOW_STATUS_LABELS = Object.freeze({
  new: '新客户', following: '跟进中', quoting: '待报价', won: '已成交', paused: '暂缓', lost: '已流失',
});
export const FAMILY_LABELS = Object.freeze({ whatsapp: 'WhatsApp', telegram: 'Telegram', line: 'LINE' });
export const EMPTY_PROFILE = Object.freeze({
  name: '', country: '', source: '', followStatus: '', nextFollowUp: '', notes: '',
});

export function normalizeIdentity(family, chatId) {
  const platform = String(family || '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(FAMILY_LABELS, platform)) return null;
  let id = String(chatId || '').trim();
  if (platform === 'telegram') id = id.replace(/^#/, '').split('?')[0].replace(/^\/+/, '');
  if (!id || id.length > 512) return null;
  return { family: platform, chatId: id };
}

export function hasProfile(profile) {
  return Object.values(profile).some(Boolean);
}

export function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

export function normalizeProfile(value) {
  const record = value && typeof value === 'object' ? value : {};
  const notes = typeof record.notes === 'string' ? record.notes
    : typeof record.text === 'string' ? record.text : '';
  return {
    name: String(record.name || '').slice(0, 100),
    country: String(record.country || '').slice(0, 80),
    source: String(record.source || '').slice(0, 100),
    followStatus: FOLLOW_STATUSES.includes(record.followStatus) ? record.followStatus : '',
    nextFollowUp: typeof record.nextFollowUp === 'string' ? record.nextFollowUp.slice(0, 16) : '',
    notes: notes.slice(0, MAX_NOTE_LENGTH),
  };
}

export function validFollowUp(value) {
  return !value || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value);
}

export function summary(profile, identity) {
  if (!identity) return '请先打开一个聊天';
  const details = [profile.name, FOLLOW_STATUS_LABELS[profile.followStatus]].filter(Boolean);
  const who = details.length ? `${details.join(' · ')}  —  ` : '';
  return `${who}${FAMILY_LABELS[identity.family]} · ${identity.chatId}`;
}

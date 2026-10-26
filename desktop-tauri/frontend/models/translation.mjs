export const LANGUAGES = Object.freeze([
  ['en', '英语'], ['es', '西班牙语'], ['fr', '法语'], ['de', '德语'], ['it', '意大利语'], ['pt', '葡萄牙语'],
  ['zh', '中文'], ['ja', '日语'], ['ko', '韩语'], ['hi', '印地语'], ['ar', '阿拉伯语'], ['ru', '俄语'],
  ['id', '印尼语'], ['pl', '波兰语'], ['tr', '土耳其语'], ['vi', '越南语'], ['nl', '荷兰语'],
  ['sv', '瑞典语'], ['el', '希腊语'], ['th', '泰语'],
]);

export const DEFAULT_POLICY = Object.freeze({
  provider: 'auto', route: 'default', enabled: false, autoSend: false, source: 'auto', target: 'en',
  messageAction: true, displayTranslation: true, translationMode: 'click', messageTarget: 'zh', messageFrom: 'auto',
  groupAuto: false, translateHistory: false, includeZh: true, fontSize: 13, fontColor: '#667eea',
});
const languages = new Set(LANGUAGES.map(([value]) => value));
const booleanKeys = ['enabled', 'autoSend', 'messageAction', 'displayTranslation', 'groupAuto', 'translateHistory', 'includeZh'];
const chatKeys = Object.freeze(['enabled', 'autoSend', 'target', 'messageAction', 'displayTranslation',
  'translationMode', 'messageTarget']);

export function policyOf(value = DEFAULT_POLICY) {
  const policy = { ...DEFAULT_POLICY, ...value };
  if (Object.keys(policy).some((key) => !Object.hasOwn(DEFAULT_POLICY, key)) || !['auto', 'local'].includes(policy.provider)
    || !['default', 'primary', 'backup'].includes(policy.route)
    || !['click', 'auto'].includes(policy.translationMode)
    || !languages.has(policy.target) || !languages.has(policy.messageTarget)
    || ![policy.source, policy.messageFrom].every((language) => language === 'auto' || languages.has(language))
    || booleanKeys.some((key) => typeof policy[key] !== 'boolean')
    || ![11, 13, 15].includes(policy.fontSize)
    || typeof policy.fontColor !== 'string' || !/^#[\da-f]{6}$/i.test(policy.fontColor)) throw 'TRANSLATION_INVALID';
  return policy;
}

export function chatPolicyOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== chatKeys.length
    || chatKeys.some((key) => !Object.hasOwn(value, key))) throw 'TRANSLATION_INVALID';
  const policy = policyOf(value);
  return Object.fromEntries(chatKeys.map((key) => [key, policy[key]]));
}

export function chatPolicyFrom(policy) {
  return chatPolicyOf(Object.fromEntries(chatKeys.map((key) => [key, policy[key]])));
}

export function effectivePolicy(global, chat = null) {
  return policyOf({ ...policyOf(global), ...(chat === null ? {} : chatPolicyOf(chat)) });
}

export function translationOf(account) {
  if (!account?.translation) return { revision: 0, global: { ...DEFAULT_POLICY }, chats: {} };
  const { revision, global, chats } = account.translation;
  if (!Number.isSafeInteger(revision) || revision < 0 || !chats || typeof chats !== 'object' || Array.isArray(chats)) {
    throw 'TRANSLATION_INVALID';
  }
  return { revision, global: policyOf(global), chats: Object.fromEntries(Object.entries(chats).map(([id, policy]) => [id, chatPolicyOf(policy)])) };
}

export function isWhatsApp(account) {
  return Boolean(account && !account.archived && ['whatsapp', 'whatsapp-pure'].includes(account.platformId));
}

export function translationCapabilities(account) {
  const whatsapp = isWhatsApp(account);
  const telegram = Boolean(account && !account.archived && ['telegram-z', 'telegram-k'].includes(account.platformId));
  const meta = Boolean(account && !account.archived && ['messenger', 'instagram'].includes(account.platformId));
  return { receive: whatsapp || telegram || meta, automatic: whatsapp || telegram,
    outgoing: whatsapp || telegram || meta };
}

export function validatePlatformPolicy(account, policy) {
  const capabilities = translationCapabilities(account);
  if (!capabilities.receive || (policy && ((!capabilities.outgoing && (policy.enabled || policy.autoSend))
    || (!capabilities.automatic && (policy.translationMode !== 'click' || policy.groupAuto))))) {
    throw 'TRANSLATION_UNAVAILABLE';
  }
}

export function sessionOf(value) {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !['signedOut', 'signedIn'].includes(value.state) || typeof value.quotaFresh !== 'boolean'
    || (value.remainingChars !== null && (!Number.isSafeInteger(value.remainingChars) || value.remainingChars < 0))
    || (value.state === 'signedIn' && (!value.user || typeof value.user.email !== 'string'))
    || (value.issue !== null && typeof value.issue !== 'string')) throw 'NETWORK_RESPONSE_INVALID';
  return { revision: value.revision, state: value.state,
    user: value.state === 'signedIn' ? { id: value.user.id, email: value.user.email, accountNo: value.user.accountNo } : null,
    remainingChars: value.remainingChars, quotaFresh: value.quotaFresh, issue: value.issue };
}

const messages = Object.freeze({
  INVALID_CREDENTIALS: '邮箱或密码不正确。',
  ACCOUNT_DISABLED: '账户已停用，请联系管理员。',
  PASSWORD_RESET_REQUIRED: '请先在官网重置密码，再重新登录。',
  RATE_LIMITED: '操作过于频繁，请稍后重试。',
  UNAUTHORIZED: '登录状态已失效，请重新登录。',
  RESPONSE_INVALID: '服务返回的数据不完整，请重新检查。',
  PERSISTENCE_FAILED: '本机账户状态保存失败，请重试。',
  CANCELLED: '账户检查已取消，请重试。',
  TIMED_OUT: '账户检查超时，请稍后重试。',
  SESSION_INVALID: '登录状态已失效，请重新登录。',
  SESSION_REQUIRED: '请先登录极客账户，再使用翻译。',
  SESSION_CHANGED: '极客账户已切换，请重试当前操作。',
  SESSION_INVALID_CREDENTIALS: '邮箱或密码不正确。',
  SESSION_ACCOUNT_DISABLED: '账户已停用，请联系管理员。',
  SESSION_PASSWORD_RESET_REQUIRED: '请先在官网重置密码，再重新登录。',
  SESSION_RATE_LIMITED: '操作过于频繁，请稍后重试。',
  SESSION_PERSISTENCE: '本机账户状态保存失败，请重试。',
  NETWORK_UNAVAILABLE: '暂时无法连接服务，请稍后重试。',
  NETWORK_RESPONSE_INVALID: '服务返回的数据不完整，请重新检查。',
  TRANSLATION_CANCELLED: '翻译已取消。',
  TRANSLATION_TIMEOUT: '翻译超时，请按需重试。',
  TRANSLATION_INVALID: '翻译设置无效，请检查后重试。',
  TRANSLATION_UNAVAILABLE: '此翻译功能暂不可用，请检查当前平台和聊天。',
  TRANSLATION_SETTINGS_CONFLICT: '设置已在其他操作中更新，草稿已保留，请检查后重试。',
  TRANSLATION_LIMIT: '翻译任务较多，请稍后重试。',
  TRANSLATION_UNAUTHORIZED: '翻译授权已失效，请重新登录。',
  TRANSLATION_QUOTA_EXHAUSTED: '翻译字符已用完，请补充余额后重试。',
  TRANSLATION_CONFLICT: '聊天内容已变化，请重新选择消息。',
  TRANSLATION_IN_PROGRESS: '此消息正在翻译，请稍候。',
  TRANSLATION_RESULT_UNAVAILABLE: '译文暂不可用，请按需重试。',
  TRANSLATION_OUTPUT_INVALID: '翻译服务未返回有效译文，请按需重试。',
  STORE_IO: '设置保存失败，草稿已保留，请重试。',
  DPAPI_FAILED: '无法安全保存设置，草稿已保留。',
});

export function translationError(code) {
  return typeof code === 'string' && Object.hasOwn(messages, code) ? messages[code] : '操作未完成，请稍后重试。';
}

export function sessionStatus(snapshot, error = '') {
  if (!snapshot) return { label: '检查中', detail: error || '正在读取极客账户状态…', quota: '字符余额未知', kind: 'idle' };
  if (snapshot.state !== 'signedIn') return { label: '需要登录', detail: error || '登录极客账户后可使用翻译。',
    quota: '字符余额未知', kind: 'warn' };
  if (error || !snapshot.quotaFresh || snapshot.remainingChars === null) {
    return { label: '余额待确认', detail: error || translationError(snapshot.issue || 'NETWORK_UNAVAILABLE'),
      quota: '字符余额未知', kind: 'warn' };
  }
  const quota = `剩余 ${snapshot.remainingChars.toLocaleString('zh-CN')} 字符`;
  return snapshot.remainingChars === 0
    ? { label: '字符已用完', detail: '字符余额为 0，请补充余额后再翻译。', quota, kind: 'error' }
    : { label: '账户已登录', detail: `${quota}。实际翻译授权和扣减以服务端为准。`, quota, kind: 'ok' };
}

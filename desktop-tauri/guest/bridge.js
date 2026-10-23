const adapter = createWhatsAppAdapter();
const GeekPlatformTransports = createPlatformCapabilities({
  familyOf: (type) => ({ key: ['whatsapp', 'whatsapp-pure'].includes(type) ? 'whatsapp' : '' }),
  definitions: { definitionFor: ({ family }) => family === 'whatsapp' ? Object.freeze({}) : null },
  contract: { validate: validateAdapter, hostRequired: ['listChats', 'prepare', 'dispatch'] },
  buildAdapter: () => adapter,
});
const mailbox = new Map();
const prepared = new Map();
const attachments = createBroadcastAttachmentBuffer();
// Document-lifetime tombstones: never evict a consumed attempt and permit replay.
// Exhaustion fails closed until the owner explicitly reloads the document.
const attempts = new Set();
let generation = '';
let revoked = false;
const token = (value) => typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value);
const alive = (expected) => !revoked && generation === expected && window === window.top;
const issue = (code) => Object.assign(new Error(code), { code });
const discard = (id) => {
  const entry = mailbox.get(id);
  if (entry) entry.cancelled = true;
  mailbox.delete(id);
};
const clean = () => {
  const now = performance.now();
  for (const [id, entry] of mailbox) if (entry.deadline <= now) discard(id);
  for (const [id, entry] of prepared) if (entry.expires <= now) {
    prepared.delete(id);
    attachments.discard(id);
  }
};

function attachment(expected, attemptId, request) {
  clean();
  const preparation = prepared.get(attemptId);
  if (!alive(expected) || !preparation || preparation.busy
      || request.index !== preparation.nextAttachment) return false;
  const metadata = preparation.value.request.attachments?.[request.index];
  if (!metadata) return false;
  switch (request.operation) {
    case 'start': return attachments.start(attemptId, request.index, metadata);
    case 'chunk': return attachments.chunk(attemptId, request.index, request.offset, request.data);
    case 'seal': return attachments.seal(attemptId, request.index);
    default: return false;
  }
}

function begin(request) {
  clean();
  if (!alive(request.generation) || !token(request.id)) return false;
  if (mailbox.has(request.id)) return true;
  if (mailbox.size >= 32) return false;
  const expected = generation;
  const maximum = request.operation === 'dispatchAttachment' ? 300000 : 35000;
  const duration = Math.max(1, Math.min(maximum, Number(request.timeoutMs) || 18000));
  const entry = { pending: true, deadline: performance.now() + duration, cancelled: false };
  const valid = () => alive(expected) && mailbox.get(request.id) === entry
    && !entry.cancelled && performance.now() < entry.deadline;
  mailbox.set(request.id, entry);
  Promise.resolve().then(async () => {
    if (!valid()) throw issue('GUEST_CHANGED');
    const transport = GeekPlatformTransports.forAccount({ type: request.platformId }, window);
    switch (request.operation) {
      case 'ready':
        await transport.ready();
        return true;
      case 'catalog': {
        const chats = await transport.listChats();
        return { capabilities: transport.capabilities(), chats };
      }
      case 'resolveContacts':
        return transport.resolveContacts(request.payload, valid);
      case 'prepare': {
        const attemptId = request.payload.attemptId;
        if (!token(attemptId) || attempts.has(attemptId) || attempts.size >= 20000 || prepared.size >= 8) {
          throw issue('NOT_SUBMITTED');
        }
        attempts.add(attemptId); // Reserve before awaiting, including failed preparations.
        const value = await transport.prepare(request.payload);
        if (!valid()) throw issue('GUEST_CHANGED');
        const duration = value.request.attachments?.length ? 20 * 60 * 1000 : 30000;
        prepared.set(attemptId, { value, expires: performance.now() + duration,
          nextAttachment: 0, busy: false, receipt: '' });
        return { prepared: true };
      }
      case 'dispatchAttachment': {
        const { attemptId, index } = request.payload;
        const preparation = prepared.get(attemptId);
        if (!preparation || preparation.busy || index !== preparation.nextAttachment) throw issue('NOT_SUBMITTED');
        const owned = attachments.take(attemptId, index);
        if (!owned) throw issue('NOT_SUBMITTED');
        preparation.busy = true;
        const current = () => valid() && prepared.get(attemptId) === preparation
          && performance.now() < preparation.expires;
        try {
          const result = await transport.dispatchAttachment(preparation.value, owned.file, index, current);
          if (result.status !== 'confirmed' || !current()) {
            prepared.delete(attemptId);
            return result;
          }
          preparation.nextAttachment += 1;
          preparation.receipt = result.receipt;
          return result;
        } finally {
          preparation.busy = false;
          owned.release();
          if (!current()) prepared.delete(attemptId);
        }
      }
      case 'dispatch': {
        const preparation = prepared.get(request.payload.attemptId);
        if (preparation?.busy) throw issue('NOT_SUBMITTED');
        prepared.delete(request.payload.attemptId);
        if (!preparation) return { status: 'notSubmitted', code: 'NOT_SUBMITTED' };
        attachments.discard(request.payload.attemptId);
        if (preparation.nextAttachment !== (preparation.value.request.attachments?.length || 0)) {
          return { status: preparation.receipt ? 'uncertain' : 'notSubmitted', code: 'NOT_SUBMITTED' };
        }
        return transport.dispatch(preparation.value, () => valid() && performance.now() < preparation.expires, preparation.receipt);
      }
      default:
        throw issue('CAPABILITY_UNAVAILABLE');
    }
  }).then((value) => {
    if (valid()) { entry.pending = false; entry.value = value; }
  }).catch((error) => {
    if (valid()) { entry.pending = false; entry.error = error.code || 'RUNTIME_FAILED'; }
  });
  return true;
}

Object.defineProperty(window, '__geekTauriPlatform', { configurable: false, writable: false,
  value: Object.freeze({
    bind: (value) => {
      if (revoked || !token(value) || (generation && generation !== value)) return false;
      generation = value;
      return true;
    },
    matches: (value) => alive(value),
    revoke: (expected) => {
      if (!alive(expected)) return;
      revoked = true;
      for (const id of mailbox.keys()) discard(id);
      prepared.clear();
      attachments.clear();
    },
    attachment,
    cancelAttempt: (expected, attemptId) => {
      if (!alive(expected)) return;
      prepared.delete(attemptId);
      attachments.discard(attemptId);
    },
    begin,
    read: (expected, id) => {
      clean();
      return alive(expected) ? (mailbox.get(id) || null) : null;
    },
    cancel: (expected, id) => { if (alive(expected)) discard(id); },
    forget: (expected, id) => { if (alive(expected)) discard(id); },
  }),
});

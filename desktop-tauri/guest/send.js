// One trusted human submission, one native-owned intent, at most one transport call.
const sendRecords = new Map();
const sendPermits = new Set();
const SEND_LIMIT = 128;
const SEND_BYTES = 2 * 1024 * 1024;
const SEND_TIMEOUT = 50000;
const UUID = /^[\da-f]{8}-[\da-f]{4}-[1-5][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
let sendBinding = '';
let sendConfiguration = null;
let sendRevoked = false;
let foreground = null;
const sendView = createSendView();
function selectSendComposer(changed) {
  const host = String(window.location?.hostname || '');
  const path = String(window.location?.pathname || '');
  if (host === 'web.telegram.org') {
    if (path === '/a' || path === '/a/') return createPageSendComposer('telegram-a', changed);
    return createTelegramSendComposer(changed);
  }
  if (host === 'www.facebook.com' || host === 'facebook.com') return createPageSendComposer('messenger', changed);
  if (host === 'www.instagram.com' || host === 'instagram.com') return createPageSendComposer('instagram', changed);
  if (window.location?.protocol === 'chrome-extension:' && host === 'ophjlpahpchlmihnnnihgmmeilfjmjjc'
      && (path === '/index.html' || path === '/index.html/') && !window.location.search) {
    return createPageSendComposer('line', changed);
  }
  return createSendComposer(changed);
}
const sendComposer = selectSendComposer(composerChanged);
const sendPolicy = (chatId) => sendConfiguration?.settings?.chats?.[chatId] || sendConfiguration?.settings?.global;
const ownsSubmit = (policy) => policy?.enabled === true && policy?.autoSend === true;
const requiresTranslation = (policy, text) => ownsSubmit(policy)
  && (policy.includeZh !== false || !/[\u3400-\u9fff]/.test(text));
const sendSemantics = (policy, text) => JSON.stringify(requiresTranslation(policy, text)
  ? ['translation', policy.source, policy.target, policy.provider, policy.route] : ['identity']);
const sendActive = () => !sendRevoked && sendConfiguration?.active === true
  && document.visibilityState !== 'hidden' && window.__geekTauriPlatform?.matches(sendBinding);
const findAttempt = (id, attempt) => {
  const record = sendRecords.get(id);
  return record?.current.number === attempt ? record : null;
};
const failedOutcome = (code, retryable = true) => ({ status: 'notSubmitted', code, retryable });
const uncertainOutcome = (code = 'SEND_INTENT_UNCERTAIN') => ({ status: 'uncertain', code, retryable: false });

function releaseComposer(attempt) {
  attempt.editor = null; attempt.chat = null;
  attempt.quoteModel = null; attempt.quoteRegion = null; attempt.quoteNodes = [];
  attempt.quoteBody = ''; attempt.quoteAuthor = ''; attempt.quoteMedia = null;
  attempt.composerState = null;
}
function failAttempt(record, code, retryable = true) {
  const attempt = record.current;
  if (attempt.submitted) return;
  attempt.stage = 'failed'; attempt.prepared = null;
  attempt.outcome = failedOutcome(code, retryable && !record.qualityRejected);
  // Retries reacquire the current composer; retain the intent/output, not old blobs.
  releaseComposer(attempt);
}
function uncertain(record, code) {
  const attempt = record.current;
  attempt.stage = 'terminal'; attempt.outcome = uncertainOutcome(code);
  attempt.mailbox = { pending: false, value: { status: 'uncertain', code: attempt.outcome.code } };
  attempt.cancelled = true; record.sticky = true;
}
function submissionRejected(record, flight, error) {
  if (record.current !== flight || flight.cancelled || sendRevoked || flight.stage !== 'committing') return;
  if (sendComposer.notSubmitted?.(error) !== true) { uncertain(record); return; }
  // Only the platform adapter's private zero-invocation proof can release an
  // already consumed permit. Untrusted error codes/booleans never establish it.
  flight.submitted = false; flight.notSubmittedProof = true; record.sticky = false;
  const code = ['SEND_INTENT_CHANGED', 'TRANSLATION_CANCELLED', 'TRANSLATION_TIMEOUT'].includes(error?.code)
    ? error.code : 'SEND_INTENT_UNSUPPORTED';
  failAttempt(record, code);
  flight.mailbox = { pending: false, value: { status: 'notSubmitted', code },
    precommit: { kind: 'telegramK', generation: sendBinding, id: record.id, attempt: flight.number, permit: flight.permit } };
}
function composerChanged(change) {
  for (const record of sendRecords.values()) {
    const attempt = record.current;
    if (record.sticky && change.trusted && change.reason === 'input'
        && sendComposer.rawText() !== record.text) { record.released = true; releaseSettled(record); }
    if (['pending', 'prepared'].includes(attempt.stage)) failAttempt(record, 'SEND_INTENT_CHANGED');
  }
  sendView.hide();
}
function releaseSettled(record) {
  const attempt = record.current;
  if ((!attempt.submitted && attempt.stage === 'failed')
      || (attempt.submitted && !attempt.awaitingDelivery && attempt.stage === 'terminal')) releaseComposer(attempt);
  if (!record.released || !attempt.submitted || attempt.awaitingDelivery || attempt.stage !== 'terminal') return;
  // Retain the bounded ID/attempt/permit receipt tombstone, not old message DOM.
  record.text = ''; record.output = null; attempt.prepared = null;
}
function expire(record) {
  const attempt = record?.current;
  if (!attempt || performance.now() - attempt.started < SEND_TIMEOUT) return;
  if (attempt.stage === 'committing') uncertain(record);
  else if (['pending', 'prepared'].includes(attempt.stage)) failAttempt(record, 'TRANSLATION_TIMEOUT');
}
function contextIssue(record) {
  const attempt = record.current;
  if (!sendActive()
      || attempt.policyRevision !== sendConfiguration.settings.revision
      || record.sessionGeneration !== sendConfiguration.sessionGeneration
      || record.semantics !== sendSemantics(sendPolicy(record.chatId), record.text)
      || !ownsSubmit(sendPolicy(record.chatId))) return 'SEND_INTENT_CHANGED';
  try {
    const value = sendComposer.read();
    return sendComposer.matches({ ...record, ...attempt }, value) ? null : 'SEND_INTENT_CHANGED';
  } catch (error) { return error?.code || 'SEND_INTENT_UNSUPPORTED'; }
}
function validAttempt(record) {
  expire(record);
  return ['pending', 'prepared'].includes(record.current.stage) ? contextIssue(record) : 'SEND_INTENT_CHANGED';
}
function visibleRecord(record) {
  return sendActive() && sendComposer.currentChat() === record.chatId
    && sendComposer.rawText() === record.text && !record.released;
}
function present(record) {
  if (!visibleRecord(record)) return;
  const attempt = record.current;
  if (attempt.outcome) sendView.outcome(attempt.outcome);
  else sendView.show(attempt.stage === 'committing' || !requiresTranslation(sendPolicy(record.chatId), record.text)
    ? '正在发送…' : '正在翻译…');
}
function requestOf(record) {
  return { id: record.id, chatId: record.chatId, text: record.text,
    context: JSON.parse(JSON.stringify(record.context)),
    composerRevision: record.current.composerRevision, policyRevision: record.current.policyRevision,
    attempt: record.current.number };
}
function retainedCandidate(value, semantics) {
  return [...sendRecords.values()].reverse().find((record) => record.chatId === value.chatId
    && record.text === value.text && record.sessionGeneration === sendConfiguration.sessionGeneration
    && record.semantics === semantics && sameSendContext(record.context, value.context)
    && !record.released && !record.current.submitted);
}
function startSubmission() {
  let value;
  try { value = sendComposer.read(); }
  catch (error) { sendView.outcome(failedOutcome(error?.code || 'SEND_INTENT_UNSUPPORTED', false)); return; }
  const sticky = [...sendRecords.values()].find((record) => record.sticky && !record.released
    && record.chatId === value.chatId && record.text === value.text);
  if (sticky) { present(sticky); return; }
  if (!sendActive()) { sendView.outcome(failedOutcome('SEND_INTENT_STATE', false)); return; }
  if (foreground) {
    expire(foreground);
    if (foreground.current.awaitingDelivery || ['pending', 'prepared', 'committing'].includes(foreground.current.stage)) {
      if (foreground.current.awaitingDelivery) sendView.show('正在确认上一条消息…');
      else if (visibleRecord(foreground)) present(foreground);
      else sendView.outcome(failedOutcome('SEND_INTENT_BUSY'));
      return;
    }
  }
  const semantics = sendSemantics(sendPolicy(value.chatId), value.text);
  let record = retainedCandidate(value, semantics);
  if (record && (!record.current.outcome?.retryable || record.qualityRejected)) { present(record); return; }
  const bytes = [...sendRecords.values()].reduce((sum, item) => sum
    + 2 * (item.text.length + (item.output?.length || 0) + (item.current.quoteBody?.length || 0)), 0);
  const reserve = 2 * (10000 - (record?.output?.length || 0));
  const quoteBytes = 2 * ((value.quoteBody?.length || 0) - (record?.current.quoteBody?.length || 0));
  if ((!record && sendRecords.size >= SEND_LIMIT) || bytes + (record ? 0 : value.text.length * 2) + quoteBytes + reserve > SEND_BYTES) {
    sendView.outcome(failedOutcome('SEND_INTENT_LIMIT', false)); return;
  }
  if (!record) {
    record = { id: crypto.randomUUID(), chatId: value.chatId, text: value.text, semantics, context: value.context,
      sessionGeneration: sendConfiguration.sessionGeneration, current: { number: 0 }, released: false };
    sendRecords.set(record.id, record);
  }
  const number = record.current.number + 1;
  if (number > 10000) { sendView.outcome(failedOutcome('SEND_INTENT_LIMIT', false)); return; }
  record.current = { number, stage: 'pending', editor: value.editor, chat: value.chat,
    composerState: value,
    quoteModel: value.quoteModel, quoteRegion: value.quoteRegion, quoteNodes: value.quoteNodes,
    quoteBody: value.quoteBody, quoteAuthor: value.quoteAuthor,
    quoteMedia: value.quoteMedia,
    composerRevision: value.composerRevision, policyRevision: sendConfiguration.settings.revision,
    started: performance.now(), submitted: false, prepared: null, outcome: null, mailbox: null };
  foreground = record; present(record);
}
function intercept(event) {
  if (event.isTrusted !== true || sendRevoked || !sendConfiguration) return;
  const submission = sendComposer.submission(event);
  if (!submission.matches) return;
  const chatId = sendComposer.currentChat();
  const text = sendComposer.rawText();
  const sticky = [...sendRecords.values()].find((record) => record.sticky && !record.released
    && record.chatId === chatId && record.text === text);
  if (!ownsSubmit(sendPolicy(chatId)) && !sticky) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (event.type === 'keydown' && event.repeat) return;
  if (!submission.supported) { sendView.outcome(failedOutcome('SEND_INTENT_UNSUPPORTED', false)); return; }
  if (sticky) { present(sticky); return; }
  startSubmission();
}
document.addEventListener('keydown', intercept, true);
document.addEventListener('mousedown', intercept, true);
document.addEventListener('click', intercept, true);

function reconcileConfiguration(value) {
  const changed = sendConfiguration && (sendConfiguration.sessionGeneration !== value.sessionGeneration
    || sendConfiguration.settings.revision !== value.settings.revision || sendConfiguration.active !== value.active);
  if (changed) {
    for (const record of sendRecords.values()) {
      if (['pending', 'prepared'].includes(record.current.stage)) failAttempt(record, 'TRANSLATION_CANCELLED');
      if (record.current.stage === 'committing' && (sendConfiguration.sessionGeneration !== value.sessionGeneration || !value.active)) {
        uncertain(record); record.current.awaitingDelivery = false;
      }
    }
    sendView.hide();
  }
  sendConfiguration = JSON.parse(JSON.stringify(value));
}
const sendApi = Object.freeze({
  configure(value) {
    if (sendRevoked || !value || !UUID.test(value.generation) || !window.__geekTauriPlatform?.matches(value.generation)
        || (sendBinding && sendBinding !== value.generation)
        || !(value.sessionGeneration === null || UUID.test(value.sessionGeneration))
        || !Number.isSafeInteger(value.settings?.revision) || value.settings.revision < 0
        || !value.settings.global || !value.settings.chats || typeof value.active !== 'boolean') return false;
    if (sendConfiguration && value.settings.revision < sendConfiguration.settings.revision) return false;
    sendBinding ||= value.generation;
    reconcileConfiguration(value);
    sendComposer.currentChat();
    return true;
  },
  poll(generation) {
    if (generation !== sendBinding || sendRevoked) return { chatId: null, request: null };
    const chatId = sendComposer.currentChat();
    if (!foreground) return { chatId, request: null };
    expire(foreground);
    // The runner treats this request as its ownership heartbeat until native
    // settlement; losing it while an ACK/read callback is in flight cancels send.
    if (foreground.current.awaitingDelivery) return { chatId, request: requestOf(foreground) };
    if (!['pending', 'prepared'].includes(foreground.current.stage)) return { chatId, request: null };
    const issue = validAttempt(foreground);
    if (issue) { failAttempt(foreground, issue); return { chatId, request: null }; }
    return { chatId, request: requestOf(foreground) };
  },
  prepare(generation, sessionGeneration, id, attempt, text, translated, expectedContext) {
    const record = findAttempt(id, attempt);
    if (generation !== sendBinding || !record || record.sessionGeneration !== sessionGeneration
        || typeof text !== 'string' || typeof translated !== 'boolean') return { ok: false, code: 'SEND_INTENT_CHANGED' };
    if (!sameSendContext(record.context, expectedContext)) {
      failAttempt(record, 'SEND_INTENT_CHANGED'); return { ok: false, code: 'SEND_INTENT_CHANGED' };
    }
    const issue = validAttempt(record);
    if (issue) { failAttempt(record, issue); return { ok: false, code: issue }; }
    const policy = sendPolicy(record.chatId);
    if (translated !== requiresTranslation(policy, record.text) || (!translated && text !== record.text)) {
      failAttempt(record, 'SEND_INTENT_INVALID', false); return { ok: false, code: 'SEND_INTENT_INVALID' };
    }
    const quality = translated ? assessOutput({ source: record.text, output: text, target: policy.target, sourceLanguage: policy.source })
      : { ok: true, text };
    if (!quality.ok || quality.text.length > 10000 || new TextEncoder().encode(quality.text).length > 32768
        || sendComposer.outputValid?.(quality.text, record) === false) {
      record.qualityRejected = true; failAttempt(record, 'TRANSLATION_OUTPUT_INVALID', false);
      return { ok: false, code: 'TRANSLATION_OUTPUT_INVALID' };
    }
    record.output = quality.text; record.current.prepared = quality.text; record.current.stage = 'prepared';
    return { ok: true };
  },
  commit(generation, id, attempt, permit) {
    const record = findAttempt(id, attempt);
    if (generation !== sendBinding || !record || !UUID.test(permit) || sendPermits.has(permit)
        || record.current.stage !== 'prepared' || record.current.submitted || validAttempt(record)) return false;
    const flight = record.current;
    sendPermits.add(permit); flight.permit = permit; flight.submitted = true; flight.stage = 'committing';
    flight.awaitingDelivery = true;
    flight.mailbox = { pending: true }; record.sticky = true;
    present(record);
    let result;
    try {
      const valid = () => {
        expire(record);
        return record.current === flight && flight.stage === 'committing' && !flight.cancelled && contextIssue(record) === null;
      };
      result = sendComposer.submit({ ...record, ...flight }, flight.prepared, valid);
    } catch (error) { submissionRejected(record, flight, error); return true; }
    Promise.resolve(result).then((value) => {
      if (record.current !== flight || flight.cancelled || sendRevoked) return;
      const receipt = typeof value?.id === 'string' ? value.id : value?.id?._serialized;
      if (typeof receipt !== 'string' || !receipt.trim() || receipt === 'submitted' || receipt.length > 500
          || /[\x00-\x1f\x7f]/.test(receipt) || !Number.isFinite(value?.ack) || value.ack < 1) {
        uncertain(record, 'SEND_INTENT_RECEIPT_MISSING'); return;
      }
      flight.stage = 'terminal';
      const draftCleared = record.context.kind === 'plain' && sendActive() && record.sessionGeneration === sendConfiguration.sessionGeneration
        && sendComposer.clear({ ...record, ...flight });
      if (draftCleared) record.released = true;
      flight.mailbox = { pending: false, value: { status: 'confirmed', receipt, draftCleared } };
      flight.outcome = { ...flight.mailbox.value, retryable: false };
    }, (error) => submissionRejected(record, flight, error));
    return true;
  },
  read(generation, id, attempt, permit) {
    const record = findAttempt(id, attempt);
    if (generation !== sendBinding || !record || record.current.permit !== permit) {
      return { pending: false, value: { status: 'notSubmitted', code: 'SEND_INTENT_STATE' } };
    }
    expire(record);
    return record.current.mailbox || { pending: false, value: { status: 'notSubmitted', code: 'SEND_INTENT_STATE' } };
  },
  deliver(generation, id, attempt, outcome) {
    const record = findAttempt(id, attempt);
    if (generation !== sendBinding || sendRevoked || !record || !outcome
        || !['confirmed', 'notSubmitted', 'uncertain'].includes(outcome.status) || typeof outcome.retryable !== 'boolean') return false;
    const flight = record.current;
    if (!flight.submitted && (record.sessionGeneration !== sendConfiguration.sessionGeneration
        || flight.policyRevision !== sendConfiguration.settings.revision)
        && !(flight.notSubmittedProof && outcome.status === 'notSubmitted')) return false;
    if (flight.stage === 'failed' && flight.outcome?.code === 'SEND_INTENT_CHANGED'
        && !(flight.notSubmittedProof && outcome.status === 'notSubmitted')) return false;
    if (flight.submitted && outcome.status === 'notSubmitted') outcome = uncertainOutcome();
    if (outcome.status === 'confirmed' && (!flight.submitted || typeof outcome.receipt !== 'string' || !outcome.receipt)) return false;
    flight.outcome = { status: outcome.status, code: typeof outcome.code === 'string' ? outcome.code : undefined,
      receipt: typeof outcome.receipt === 'string' ? outcome.receipt : undefined,
      draftCleared: record.context.kind === 'plain' && outcome.draftCleared === true,
      retryable: outcome.status === 'notSubmitted' && outcome.retryable && !record.qualityRejected };
    flight.stage = outcome.status === 'notSubmitted' ? 'failed' : 'terminal';
    flight.awaitingDelivery = false;
    record.sticky ||= outcome.status !== 'notSubmitted';
    present(record);
    if (outcome.status === 'confirmed' && outcome.draftCleared && sendActive() && sendComposer.currentChat() === record.chatId) sendView.outcome(flight.outcome);
    releaseSettled(record);
    return true;
  },
  cancel(generation, id, attempt) {
    const record = findAttempt(id, attempt);
    if (generation !== sendBinding || sendRevoked || !record) return false;
    if (record.current.submitted) uncertain(record);
    else if (['pending', 'prepared'].includes(record.current.stage)) failAttempt(record, 'TRANSLATION_CANCELLED');
    record.current.awaitingDelivery = false; sendView.hide(); return true;
  },
  deactivate(generation) {
    if (generation !== sendBinding || sendRevoked || !sendConfiguration) return false;
    sendConfiguration.active = false;
    for (const record of sendRecords.values()) {
      if (record.current.stage === 'committing') uncertain(record);
      else if (['pending', 'prepared'].includes(record.current.stage)) failAttempt(record, 'TRANSLATION_CANCELLED');
      record.current.awaitingDelivery = false;
    }
    sendView.hide(); return true;
  },
  revoke(generation) {
    if (generation !== sendBinding || sendRevoked) return false;
    for (const record of sendRecords.values()) {
      if (record.current.submitted && record.current.stage === 'committing') uncertain(record);
      else if (['pending', 'prepared'].includes(record.current.stage)) failAttempt(record, 'TRANSLATION_CANCELLED', false);
    }
    sendRevoked = true; sendView.dispose(); sendComposer.dispose();
    document.removeEventListener('keydown', intercept, true);
    document.removeEventListener('mousedown', intercept, true);
    document.removeEventListener('click', intercept, true);
    return true;
  },
});
Object.defineProperty(window, '__geekTauriSend', { value: sendApi, configurable: false, writable: false });

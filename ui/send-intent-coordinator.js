(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekSendIntentCoordinator = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const TERMINAL_STATES = Object.freeze(new Set(['sent', 'cancelled', 'failed']));
  const BINDING_FIELDS = Object.freeze([
    'accountId',
    'partition',
    'platform',
    'webviewId',
    'webviewGeneration',
    'conversationId',
    'composerGeneration',
    'submitPermitId',
  ]);

  function intentError(code, field = '') {
    const error = new Error(String(code || 'SEND_INTENT_FAILED'));
    error.code = String(code || 'SEND_INTENT_FAILED');
    if (field) error.field = String(field);
    return error;
  }
  function requiredText(value, field) {
    const text = String(value == null ? '' : value).trim();
    if (!text) throw intentError('SEND_INTENT_INVALID', field);
    return text;
  }

  function generation(value, field) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) throw intentError('SEND_INTENT_INVALID', field);
    return number;
  }

  function clonePolicy(value, depth = 0) {
    if (depth > 12) throw intentError('SEND_INTENT_POLICY_INVALID');
    if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw intentError('SEND_INTENT_POLICY_INVALID');
      return value;
    }
    if (Array.isArray(value)) return Object.freeze(value.map(item => clonePolicy(item, depth + 1)));
    if (typeof value !== 'object') throw intentError('SEND_INTENT_POLICY_INVALID');
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw intentError('SEND_INTENT_POLICY_INVALID');
    const out = Object.create(null);
    for (const [key, item] of Object.entries(value)) out[key] = clonePolicy(item, depth + 1);
    return Object.freeze(out);
  }
  function normalizeBinding(input = {}) {
    return Object.freeze({
      accountId: requiredText(input.accountId, 'accountId'),
      partition: requiredText(input.partition, 'partition'),
      platform: requiredText(input.platform, 'platform'),
      webviewId: requiredText(input.webviewId, 'webviewId'),
      webviewGeneration: generation(input.webviewGeneration, 'webviewGeneration'),
      conversationId: requiredText(input.conversationId, 'conversationId'),
      composerGeneration: generation(input.composerGeneration, 'composerGeneration'),
      submitPermitId: requiredText(input.submitPermitId, 'submitPermitId'),
    });
  }

  function secureIntentId() {
    const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }
    throw intentError('SEND_INTENT_ID_UNAVAILABLE');
  }

  function createCoordinator(options = {}) {
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    const idFactory = typeof options.idFactory === 'function' ? options.idFactory : secureIntentId;
    const AbortControllerImpl = options.AbortController || globalThis.AbortController;
    const maxRecords = options.maxRecords == null ? 256 : Number(options.maxRecords);
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) throw intentError('SEND_INTENT_INVALID', 'maxRecords');
    if (typeof AbortControllerImpl !== 'function') throw intentError('SEND_INTENT_ABORT_UNAVAILABLE');
    const records = new Map();
    function getRecord(intentId) {
      const record = records.get(String(intentId || ''));
      if (!record) throw intentError('SEND_INTENT_NOT_FOUND');
      return record;
    }

    function project(record) {
      return Object.freeze({
        intentId: record.intentId,
        platform: record.binding.platform,
        state: record.state,
        createdAt: record.createdAt,
        deadlineAt: record.deadlineAt,
        updatedAt: record.updatedAt,
        terminalAt: record.terminalAt || null,
        failureCode: record.failureCode || '',
        cancellationCode: record.cancellationCode || '',
      });
    }

    function pruneOldestTerminalForCapacity() {
      if (records.size < maxRecords) return;
      for (const [intentId, record] of records) {
        if (!TERMINAL_STATES.has(record.state)) continue;
        records.delete(intentId);
        if (records.size < maxRecords) return;
      }
      if (records.size >= maxRecords) throw intentError('SEND_INTENT_CAPACITY');
    }
    function ensureBeforeDeadline(record) {
      if (now() >= record.deadlineAt) throw intentError('SEND_INTENT_DEADLINE_EXCEEDED');
    }

    function ensureState(record, expected) {
      const allowed = Array.isArray(expected) ? expected : [expected];
      if (!allowed.includes(record.state)) throw intentError('SEND_INTENT_INVALID_STATE');
    }

    function setState(record, state) {
      record.state = state;
      record.updatedAt = now();
      if (TERMINAL_STATES.has(state)) record.terminalAt = record.updatedAt;
      return project(record);
    }

    function begin(input = {}) {
      pruneOldestTerminalForCapacity();
      const createdAt = now();
      const deadlineAt = Number(input.deadlineAt);
      if (!Number.isFinite(deadlineAt) || deadlineAt <= createdAt) {
        throw intentError('SEND_INTENT_INVALID', 'deadlineAt');
      }
      if (typeof input.sourceSnapshot !== 'string') throw intentError('SEND_INTENT_INVALID', 'sourceSnapshot');
      const intentId = requiredText(idFactory(), 'intentId');
      if (records.has(intentId)) throw intentError('SEND_INTENT_DUPLICATE');
      const binding = normalizeBinding(input);
      const controller = new AbortControllerImpl();
      const record = {
        intentId, binding, sourceSnapshot: input.sourceSnapshot,
        transformPolicy: clonePolicy(input.transformPolicy || {}),
        createdAt, deadlineAt, updatedAt: createdAt, terminalAt: null,
        state: 'created', failureCode: '', cancellationCode: '', controller,
      };
      records.set(intentId, record);
      return project(record);
    }
    function startTransform(intentId) {
      const record = getRecord(intentId);
      ensureState(record, 'created');
      ensureBeforeDeadline(record);
      return setState(record, 'transforming');
    }

    function markReady(intentId) {
      const record = getRecord(intentId);
      ensureState(record, 'transforming');
      ensureBeforeDeadline(record);
      return setState(record, 'ready');
    }

    function beginCommit(intentId, currentBinding) {
      const record = getRecord(intentId);
      ensureState(record, 'ready');
      ensureBeforeDeadline(record);
      const current = normalizeBinding(currentBinding);
      for (const field of BINDING_FIELDS) {
        if (current[field] !== record.binding[field]) throw intentError('SEND_INTENT_STALE_CONTEXT', field);
      }
      return setState(record, 'committing');
    }

    function markSent(intentId) {
      const record = getRecord(intentId);
      ensureState(record, 'committing');
      return setState(record, 'sent');
    }
    function cancel(intentId, code = 'SEND_INTENT_CANCELLED') {
      const record = getRecord(intentId);
      if (record.state === 'cancelled') return project(record);
      if (record.state === 'committing' || record.state === 'sent') {
        throw intentError('SEND_INTENT_COMMIT_IN_PROGRESS');
      }
      ensureState(record, ['created', 'transforming', 'ready']);
      record.cancellationCode = requiredText(code, 'cancellationCode');
      if (!record.controller.signal.aborted) record.controller.abort(intentError(record.cancellationCode));
      return setState(record, 'cancelled');
    }

    function fail(intentId, code = 'SEND_INTENT_FAILED') {
      const record = getRecord(intentId);
      ensureState(record, ['created', 'transforming', 'ready', 'committing']);
      record.failureCode = requiredText(code, 'failureCode');
      if (!record.controller.signal.aborted) record.controller.abort(intentError(record.failureCode));
      return setState(record, 'failed');
    }

    function forget(intentId) {
      const record = getRecord(intentId);
      if (!TERMINAL_STATES.has(record.state)) throw intentError('SEND_INTENT_NOT_TERMINAL');
      records.delete(record.intentId);
      return true;
    }
    return Object.freeze({
      begin,
      get: intentId => project(getRecord(intentId)),
      readSource: intentId => getRecord(intentId).sourceSnapshot,
      readTransformPolicy: intentId => getRecord(intentId).transformPolicy,
      signal: intentId => getRecord(intentId).controller.signal,
      startTransform,
      markReady,
      beginCommit,
      markSent,
      cancel,
      fail,
      forget,
      size: () => records.size,
    });
  }

  return Object.freeze({
    TERMINAL_STATES: Object.freeze(Array.from(TERMINAL_STATES)),
    BINDING_FIELDS,
    createCoordinator,
  });
});

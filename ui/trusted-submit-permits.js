(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekTrustedSubmitPermits = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const SUBMIT_KINDS = Object.freeze(['keyboard', 'button']);
  const BINDING_FIELDS = Object.freeze([
    'accountId',
    'partition',
    'platform',
    'webviewId',
    'webviewGeneration',
  ]);

  function permitError(code, field = '') {
    const error = new Error(String(code || 'SUBMIT_PERMIT_FAILED'));
    error.code = String(code || 'SUBMIT_PERMIT_FAILED');
    if (field) error.field = String(field);
    return error;
  }

  function requiredText(value, field) {
    const text = String(value == null ? '' : value).trim();
    if (!text) throw permitError('SUBMIT_PERMIT_INVALID', field);
    return text;
  }

  function generation(value) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
      throw permitError('SUBMIT_PERMIT_INVALID', 'webviewGeneration');
    }
    return number;
  }

  function normalizeBinding(input = {}) {
    return Object.freeze({
      accountId: requiredText(input.accountId, 'accountId'),
      partition: requiredText(input.partition, 'partition'),
      platform: requiredText(input.platform, 'platform'),
      webviewId: requiredText(input.webviewId, 'webviewId'),
      webviewGeneration: generation(input.webviewGeneration),
    });
  }

  function normalizeKind(value) {
    const kind = requiredText(value, 'kind');
    if (!SUBMIT_KINDS.includes(kind)) throw permitError('SUBMIT_PERMIT_INVALID', 'kind');
    return kind;
  }

  function securePermitId() {
    const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }
    throw permitError('SUBMIT_PERMIT_ID_UNAVAILABLE');
  }

  function createAuthority(options = {}) {
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    const idFactory = typeof options.idFactory === 'function' ? options.idFactory : securePermitId;
    const ttlMs = options.ttlMs == null ? 2000 : Number(options.ttlMs);
    const maxRecords = options.maxRecords == null ? 256 : Number(options.maxRecords);

    if (!Number.isSafeInteger(ttlMs) || ttlMs < 100 || ttlMs > 10000) {
      throw permitError('SUBMIT_PERMIT_INVALID', 'ttlMs');
    }
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) {
      throw permitError('SUBMIT_PERMIT_INVALID', 'maxRecords');
    }

    const records = new Map();

    function recordFor(permitId) {
      const record = records.get(String(permitId || ''));
      if (!record) throw permitError('SUBMIT_PERMIT_NOT_FOUND');
      return record;
    }

    function project(record) {
      return Object.freeze({
        kind: record.kind,
        state: record.state,
        issuedAt: record.issuedAt,
        expiresAt: record.expiresAt,
        consumedAt: record.consumedAt || null,
      });
    }

    function expire(record, time = now()) {
      if (record.state === 'issued' && time >= record.expiresAt) record.state = 'expired';
      return record.state === 'expired';
    }

    function sweep() {
      const time = now();
      let removed = 0;
      for (const [permitId, record] of records) {
        expire(record, time);
        if (record.state === 'expired' || record.state === 'consumed') {
          records.delete(permitId);
          removed += 1;
        }
      }
      return removed;
    }

    function ensureCapacity() {
      if (records.size < maxRecords) return;
      sweep();
      if (records.size >= maxRecords) throw permitError('SUBMIT_PERMIT_CAPACITY');
    }

    function issue(input = {}) {
      ensureCapacity();
      const issuedAt = now();
      const permitId = requiredText(idFactory(), 'permitId');
      if (records.has(permitId)) throw permitError('SUBMIT_PERMIT_DUPLICATE');
      const record = {
        permitId,
        binding: normalizeBinding(input),
        kind: normalizeKind(input.kind),
        issuedAt,
        expiresAt: issuedAt + ttlMs,
        consumedAt: null,
        state: 'issued',
      };
      records.set(permitId, record);
      return Object.freeze({ permitId, expiresAt: record.expiresAt });
    }

    function consume(permitId, currentBinding) {
      const record = recordFor(permitId);
      if (record.state === 'consumed') throw permitError('SUBMIT_PERMIT_REPLAY');
      if (expire(record)) throw permitError('SUBMIT_PERMIT_EXPIRED');
      if (record.state !== 'issued') throw permitError('SUBMIT_PERMIT_INVALID_STATE');

      const current = normalizeBinding(currentBinding);
      for (const field of BINDING_FIELDS) {
        if (current[field] !== record.binding[field]) {
          throw permitError('SUBMIT_PERMIT_STALE_BINDING', field);
        }
      }

      record.state = 'consumed';
      record.consumedAt = now();
      return project(record);
    }

    return Object.freeze({
      issue,
      consume,
      get: permitId => {
        const record = recordFor(permitId);
        expire(record);
        return project(record);
      },
      sweep,
      size: () => records.size,
    });
  }

  return Object.freeze({
    SUBMIT_KINDS,
    BINDING_FIELDS,
    createAuthority,
  });
});

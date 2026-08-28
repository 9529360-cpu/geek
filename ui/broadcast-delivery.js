(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastDelivery = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function normalizeOutcome(value) {
    if (value === true || value === 'SENT' || value === 'CLICKED') return { ok: true, reason: '', value };
    if (value && typeof value === 'object' && value.ok === true) return { ok: true, reason: '', value };
    if (value && typeof value === 'object') return { ok: false, reason: String(value.reason || value.error || 'SEND_FAILED'), value };
    return { ok: false, reason: String(value || 'SEND_FAILED'), value };
  }

  async function retryUnconfirmed(operation, attempts = 2) {
    let last = { ok: false, reason: 'SEND_FAILED', value: null };
    const limit = Math.max(1, Number(attempts) || 1);
    for (let attempt = 1; attempt <= limit; attempt++) {
      try {
        last = normalizeOutcome(await operation(attempt));
      } catch (error) {
        last = { ok: false, reason: String(error?.message || error || 'SEND_EXCEPTION'), value: null };
      }
      if (last.ok) return { ...last, attempts: attempt };
    }
    return { ...last, attempts: limit };
  }

  async function sendDirectBundle(options = {}) {
    const files = Array.isArray(options.files) ? options.files : [];
    const vcards = Array.isArray(options.vcards) ? options.vcards : [];
    const message = String(options.message || '');
    const failures = [];

    if (!files.length && !message.trim() && !vcards.length) return { ok: false, reason: 'NO_CONTENT' };

    if (files.length) {
      if (typeof options.sendFile !== 'function') return { ok: false, reason: 'ATTACHMENT_TRANSPORT_UNAVAILABLE' };
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        const caption = index === files.length - 1 ? message : '';
        const outcome = await retryUnconfirmed(
          attempt => options.sendFile({ file, index, caption, attempt }),
          options.fileAttempts == null ? 2 : options.fileAttempts
        );
        if (!outcome.ok) failures.push(`${String(file?.name || `附件${index + 1}`)}:${outcome.reason}`);
      }
      if (failures.length) return { ok: false, reason: `ERR:附件:${failures.join(' | ')}` };
    } else if (message.trim()) {
      if (typeof options.sendText !== 'function') return { ok: false, reason: 'TEXT_TRANSPORT_UNAVAILABLE' };
      const outcome = await retryUnconfirmed(options.sendText, options.textAttempts == null ? 2 : options.textAttempts);
      if (!outcome.ok) return { ok: false, reason: `ERR:正文:${outcome.reason}` };
    }

    if (vcards.length) {
      if (typeof options.sendVcards !== 'function') return { ok: false, reason: 'ERR:名片:VCARD_TRANSPORT_UNAVAILABLE' };
      let outcome;
      try { outcome = normalizeOutcome(await options.sendVcards(vcards)); }
      catch (error) { outcome = { ok: false, reason: String(error?.message || error || 'VCARD_SEND_EXCEPTION') }; }
      if (!outcome.ok) return { ok: false, reason: `ERR:名片:${outcome.reason}` };
    }

    return { ok: true, reason: '' };
  }

  return Object.freeze({ normalizeOutcome, retryUnconfirmed, sendDirectBundle });
});

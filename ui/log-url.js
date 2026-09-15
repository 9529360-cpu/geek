(() => {
  'use strict';

  const REDACTED_PATH = '[REDACTED_PATH]';
  const REDACTED_VALUE = '[REDACTED]';

  function sanitizeParsedUrl(parsed) {
    if (parsed.protocol === 'about:' && parsed.pathname === 'blank') return 'about:blank';

    if (parsed.host) {
      const authority = `${parsed.protocol}//${parsed.host}`;
      return parsed.pathname && parsed.pathname !== '/'
        ? `${authority}/${REDACTED_PATH}`
        : `${authority}/`;
    }

    return `${parsed.protocol}${REDACTED_VALUE}`;
  }

  function sanitizeMalformedUrl(raw) {
    const authorityMatch = raw.match(/^([a-z][a-z0-9+.-]*:\/\/)(?:[^/@?#\s]+@)?([^/?#\s]+)/i);
    if (authorityMatch) {
      const prefix = authorityMatch[1];
      const host = authorityMatch[2].slice(0, 255);
      return `${prefix}${host}/${REDACTED_PATH}`;
    }

    const schemeMatch = raw.match(/^([a-z][a-z0-9+.-]*:)/i);
    if (schemeMatch) return `${schemeMatch[1]}${REDACTED_VALUE}`;
    return '[INVALID_URL]';
  }

  function sanitizeUrlForLog(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';

    try {
      return sanitizeParsedUrl(new URL(raw));
    } catch {
      return sanitizeMalformedUrl(raw);
    }
  }

  const api = Object.freeze({ sanitizeUrlForLog });
  if (typeof window !== 'undefined') window.GeekLogUrl = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

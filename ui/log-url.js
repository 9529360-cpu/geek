(() => {
  'use strict';

  function sanitizeUrlForLog(value) {
    const raw = String(value ?? '');
    if (!raw) return '';

    try {
      const parsed = new URL(raw);
      const authority = parsed.host ? `//${parsed.host}` : '';
      return `${parsed.protocol}${authority}${parsed.pathname}`;
    } catch {
      return raw.split(/[?#]/, 1)[0].slice(0, 512);
    }
  }

  const api = Object.freeze({ sanitizeUrlForLog });
  if (typeof window !== 'undefined') window.GeekLogUrl = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

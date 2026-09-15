'use strict';

const TRANSLATION_LANGUAGE_CODES = Object.freeze([
  'en', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'ja', 'ko', 'hi',
  'ar', 'ru', 'id', 'pl', 'tr', 'vi', 'nl', 'sv', 'el', 'th',
]);
const TRANSLATION_LANGUAGE_SET = new Set(TRANSLATION_LANGUAGE_CODES);

function normalizeTranslationLanguage(value, options = {}) {
  const allowAuto = options.allowAuto === true;
  const fallback = allowAuto ? 'auto' : '';
  const normalized = String(value == null || value === '' ? fallback : value).trim().toLowerCase();
  if (allowAuto && normalized === 'auto') return 'auto';
  return TRANSLATION_LANGUAGE_SET.has(normalized) ? normalized : '';
}

module.exports = {
  TRANSLATION_LANGUAGE_CODES,
  normalizeTranslationLanguage,
};

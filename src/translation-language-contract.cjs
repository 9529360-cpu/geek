'use strict';

const TRANSLATION_LANGUAGE_NAMES = Object.freeze({
  zh: 'Simplified Chinese',
  en: 'English',
  it: 'Italian',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  ja: 'Japanese',
  ko: 'Korean',
  hi: 'Hindi',
  ar: 'Arabic',
  ru: 'Russian',
  id: 'Indonesian',
  pl: 'Polish',
  tr: 'Turkish',
  vi: 'Vietnamese',
  nl: 'Dutch',
  sv: 'Swedish',
  el: 'Greek',
  th: 'Thai',
});
const TRANSLATION_LANGUAGE_CODES = Object.freeze(Object.keys(TRANSLATION_LANGUAGE_NAMES));
const languageCodes = new Set(TRANSLATION_LANGUAGE_CODES);

function normalizeTranslationSourceLanguage(value) {
  const code = String(value || 'auto').trim().toLowerCase();
  if (code === 'auto') return 'auto';
  return languageCodes.has(code) ? code : null;
}

function normalizeTranslationTargetLanguage(value) {
  const code = String(value || '').trim().toLowerCase();
  return languageCodes.has(code) ? code : null;
}

function translationLanguageName(code) {
  return TRANSLATION_LANGUAGE_NAMES[String(code || '').trim().toLowerCase()] || '';
}

module.exports = {
  TRANSLATION_LANGUAGE_NAMES,
  TRANSLATION_LANGUAGE_CODES,
  normalizeTranslationSourceLanguage,
  normalizeTranslationTargetLanguage,
  translationLanguageName,
};

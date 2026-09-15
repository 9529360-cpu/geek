'use strict';

const LATIN_TARGETS = new Set(['en', 'it', 'es', 'fr', 'de', 'pt', 'id', 'pl', 'tr', 'vi', 'nl', 'sv']);
const META_PREFIXES = [
  /^(?:以下|下面)(?:是|为)?[^\n：:]{0,30}(?:翻译|译文|翻译结果)(?:成|为|至)?[^\n：:]{0,30}[：:]?\s*/i,
  /^(?:翻译|译文|翻译结果)(?:成|为|至)?[^\n：:]{0,30}[：:]\s*/i,
  /^(?:here(?:'s| is)|below is|the following is)\s+(?:the\s+)?(?:translation|translated text)(?:\s+(?:in|into|to)\s+[^:\n]{1,30})?[：:]?\s*/i,
  /^(?:translation|translated text)(?:\s+(?:in|into|to)\s+[^:\n]{1,30})?[：:]\s*/i,
  /^(?:sure|certainly|of course)[,!：:\s-]+here(?:'s| is)\s+(?:the\s+)?(?:translation|translated text)(?:\s+(?:in|into|to)\s+[^:\n]{1,30})?[：:]?\s*/i,
];
const URL_OR_EMAIL_RE = /(?:https?:\/\/|www\.)\S+|\b[^\s@]+@[^\s@]+\.[^\s@]+\b/giu;
const WORD_CHAR_RE = /[\p{L}\p{N}]/gu;
const LETTER_RE = /\p{L}/gu;
const SCRIPT_PATTERNS = Object.freeze({
  latin: /[A-Za-zÀ-ÖØ-öø-ÿĀ-ž]/g,
  han: /[\u3400-\u9fff]/g,
  kana: /[\u3040-\u30ff]/g,
  hangul: /[\uac00-\ud7af]/g,
  devanagari: /[\u0900-\u097f]/g,
  arabic: /[\u0600-\u06ff]/g,
  cyrillic: /[\u0400-\u04ff]/g,
  greek: /[\u0370-\u03ff]/g,
  thai: /[\u0e00-\u0e7f]/g,
});
const LANGUAGE_SCRIPT = Object.freeze({
  zh: 'han', ja: 'japanese', ko: 'hangul', hi: 'devanagari', ar: 'arabic', ru: 'cyrillic', el: 'greek', th: 'thai',
  en: 'latin', it: 'latin', es: 'latin', fr: 'latin', de: 'latin', pt: 'latin', id: 'latin', pl: 'latin', tr: 'latin', vi: 'latin', nl: 'latin', sv: 'latin',
});

function stripOuterFence(value) {
  const text = String(value || '').trim();
  const fenced = text.match(/^```(?:[a-z-]+)?\s*\n?([\s\S]*?)\n?```$/i);
  return fenced ? fenced[1].trim() : text;
}

function sanitizeTranslationOutput(value) {
  let text = stripOuterFence(value)
    .replace(/^<think>[\s\S]*?<\/think>\s*/i, '')
    .replace(/^(?:Here's a thinking process|Let me think|I'll translate|以下是思考过程|让我思考)[：:\s]*/i, '')
    .trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const before = text;
    for (const pattern of META_PREFIXES) text = text.replace(pattern, '').trim();
    if (text === before) break;
  }
  return stripOuterFence(text);
}

function comparable(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function invariantOnly(value) {
  const raw = String(value || '').trim();
  if (!raw) return true;
  const withoutLinks = raw.replace(URL_OR_EMAIL_RE, ' ');
  const letters = withoutLinks.match(LETTER_RE) || [];
  const wordChars = withoutLinks.match(WORD_CHAR_RE) || [];
  if (!letters.length) return true;
  const tokens = withoutLinks.split(/\s+/u).filter(Boolean);
  if (tokens.length <= 2 && wordChars.length <= 24 && tokens.every(token => /^[\p{Lu}\p{Lt}][\p{L}\p{M}'’-]*$/u.test(token))) return true;
  if (/^[A-Z0-9._:/+-]{1,24}$/.test(raw)) return true;
  return false;
}

function scriptCount(value, script) {
  const text = String(value || '');
  if (script === 'japanese') {
    return (text.match(SCRIPT_PATTERNS.han) || []).length + (text.match(SCRIPT_PATTERNS.kana) || []).length;
  }
  const pattern = SCRIPT_PATTERNS[script];
  return pattern ? (text.match(pattern) || []).length : 0;
}

function assessTranslationOutput({ source, output, target, sourceLanguage = 'auto' } = {}) {
  const original = String(source || '').trim();
  const text = sanitizeTranslationOutput(output);
  const language = String(target || '').toLowerCase();
  const sourceCode = String(sourceLanguage || 'auto').toLowerCase();
  if (!text) return { ok: false, text: '', reason: 'EMPTY_TRANSLATION' };
  if (META_PREFIXES.some(pattern => pattern.test(text))) return { ok: false, text, reason: 'META_PREAMBLE' };
  if (text.length > Math.max(800, original.length * 8 + 160)) return { ok: false, text, reason: 'SUSPICIOUS_LENGTH' };

  const unchanged = comparable(original) === comparable(text);
  if (sourceCode !== 'auto' && sourceCode !== language && unchanged && !invariantOnly(original)) {
    return { ok: false, text, reason: 'UNCHANGED_SOURCE' };
  }

  const sourceCjk = (original.match(/[\u3400-\u9fff]/g) || []).length;
  const outputCjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  if (sourceCode === 'auto' && language !== 'zh' && sourceCjk > 0 && unchanged) {
    return { ok: false, text, reason: 'UNCHANGED_SOURCE' };
  }

  const targetScript = LANGUAGE_SCRIPT[language];
  const sourceScript = LANGUAGE_SCRIPT[sourceCode];
  if (targetScript && sourceCode !== 'auto' && sourceCode !== language && sourceScript && sourceScript !== targetScript && !invariantOnly(original)) {
    const targetChars = scriptCount(text, targetScript);
    const letters = text.match(LETTER_RE) || [];
    if (letters.length >= 2 && targetChars < 2) return { ok: false, text, reason: 'TARGET_SCRIPT_MISMATCH' };
  } else if (sourceCode === 'auto' && LATIN_TARGETS.has(language) && sourceCjk >= 2) {
    const latinLetters = scriptCount(text, 'latin');
    if (latinLetters < 2 && outputCjk >= Math.max(2, Math.ceil(sourceCjk * 0.5))) {
      return { ok: false, text, reason: 'TARGET_SCRIPT_MISMATCH' };
    }
  }
  return { ok: true, text, reason: '' };
}

function assertSafeTranslationOutput(input) {
  const result = assessTranslationOutput(input);
  if (!result.ok) {
    const error = new Error(`译文质量校验失败: ${result.reason}`);
    error.code = result.reason;
    throw error;
  }
  return result.text;
}

module.exports = { sanitizeTranslationOutput, assessTranslationOutput, assertSafeTranslationOutput };

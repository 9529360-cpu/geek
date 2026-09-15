'use strict';

const LATIN_TARGETS = new Set(['en', 'it', 'es', 'fr', 'de', 'pt', 'id', 'pl', 'tr', 'vi', 'nl', 'sv']);
const META_PREFIXES = [
  /^(?:以下|下面)(?:是|为)?[^\n：:]{0,30}(?:翻译|译文|翻译结果)(?:成|为|至)?[^\n：:]{0,30}[：:]?\s*/i,
  /^(?:翻译|译文|翻译结果)(?:成|为|至)?[^\n：:]{0,30}[：:]\s*/i,
  /^(?:here(?:'s| is)|below is|the following is)\s+(?:the\s+)?(?:translation|translated text)(?:\s+(?:in|into|to)\s+[^:\n]{1,30})?[：:]?\s*/i,
  /^(?:translation|translated text)(?:\s+(?:in|into|to)\s+[^:\n]{1,30})?[：:]\s*/i,
  /^(?:sure|certainly|of course)[,!：:\s-]+here(?:'s| is)\s+(?:the\s+)?(?:translation|translated text)(?:\s+(?:in|into|to)\s+[^:\n]{1,30})?[：:]?\s*/i,
];

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

function assessTranslationOutput({ source, output, target } = {}) {
  const original = String(source || '').trim();
  const text = sanitizeTranslationOutput(output);
  const language = String(target || '').toLowerCase();
  if (!text) return { ok: false, text: '', reason: 'EMPTY_TRANSLATION' };
  if (META_PREFIXES.some(pattern => pattern.test(text))) return { ok: false, text, reason: 'META_PREAMBLE' };
  if (text.length > Math.max(800, original.length * 8 + 160)) return { ok: false, text, reason: 'SUSPICIOUS_LENGTH' };

  const sourceCjk = (original.match(/[\u3400-\u9fff]/g) || []).length;
  const outputCjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  if (language !== 'zh' && sourceCjk > 0 && comparable(original) === comparable(text)) {
    return { ok: false, text, reason: 'UNCHANGED_SOURCE' };
  }
  if (LATIN_TARGETS.has(language) && sourceCjk >= 2) {
    const latinLetters = (text.match(/[A-Za-zÀ-ÖØ-öø-ÿĀ-ž]/g) || []).length;
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

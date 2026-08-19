'use strict';
const fs = require('node:fs');
const path = require('node:path');

const file = path.resolve(__dirname, '..', 'test', 'translation-settings-ux-contract.cjs');
let source = fs.readFileSync(file, 'utf8');
const needle = "assert.match(ux, /setStorage\\('translationGlobal', JSON\\.stringify\\(DEFAULTS\\)\\)/, '翻译恢复默认必须只复用现有 translationGlobal 与 DEFAULTS');\n";
const replacement = "assert.match(ux.slice(resetStart, resetEnd), /key: 'translationGlobal'[\\s\\S]*payload: JSON\\.stringify\\(DEFAULTS\\)/, '翻译恢复默认必须只复用现有 translationGlobal 与 DEFAULTS');\n";
const first = source.indexOf(needle);
if (first < 0) throw new Error('legacy reset assertion anchor missing');
if (source.indexOf(needle, first + needle.length) >= 0) throw new Error('legacy reset assertion anchor not unique');
source = source.slice(0, first) + replacement + source.slice(first + needle.length);
fs.writeFileSync(file, source);
console.log('TRANSLATION_SAVE_FEEDBACK_LEGACY_CONTRACT_PATCH_OK');

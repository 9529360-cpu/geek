'use strict';

require('./line-pasted-image-submit-v7-temp.cjs');

const fs = require('node:fs');

function replaceOnce(text, before, after, label) {
  const normalizedText = text.replace(/\r\n/g, '\n');
  const normalizedBefore = before.replace(/\r\n/g, '\n');
  const count = normalizedText.split(normalizedBefore).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}`);
  return normalizedText.replace(normalizedBefore, after);
}

let ui = fs.readFileSync('ui/app.js', 'utf8');
ui = replaceOnce(ui,
  `        if (text.trim()) {\n          textarea.focus();\n          document.execCommand('selectAll', false, null);\n          host.insertValue([text]);\n          const actual = (Array.isArray(host.value) ? host.value : [host.value]).filter(value => typeof value === 'string').join('').trim();\n          if (actual !== text.trim()) return 'TEXT_SET_FAILED';\n        }\n        textarea.focus();`,
  `        if (text.trim()) {\n          textarea.focus();\n          document.execCommand('selectAll', false, null);\n          host.insertValue([text]);\n          let textStableChecks = 0;\n          for (let i = 0; i < 20; i++) {\n            await new Promise(resolve => setTimeout(resolve, 50));\n            const actual = (Array.isArray(host.value) ? host.value : [host.value])\n              .filter(value => typeof value === 'string')\n              .join('')\n              .trim();\n            if (actual === text.trim()) textStableChecks += 1;\n            else textStableChecks = 0;\n            if (textStableChecks >= 3) break;\n          }\n          if (textStableChecks < 3) return 'TEXT_STATE_NOT_READY';\n          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));\n        }\n        textarea.focus();`,
  'LINE text state stabilization before native submit');

ui = replaceOnce(ui,
  `        const requiredNew = expected + (text.trim() ? 1 : 0);\n        let pastedCleared = false;\n        for (let i = 0; i < 240; i++) {\n          await new Promise(resolve => setTimeout(resolve, 250));\n          const pastedCount = document.querySelectorAll(pastedSelector).length;\n          if (pastedCount === 0) pastedCleared = true;\n          const currentIds = [...document.querySelectorAll('[class*="message-module__message__"][data-mid]')].map(el => el.getAttribute('data-mid')).filter(Boolean);\n          const addedIds = currentIds.filter(id => !baselineIds.has(id));\n          if (pastedCleared && addedIds.length >= requiredNew) return 'SENT';\n        }\n        return pastedCleared ? 'LINE_MESSAGE_NOT_CONFIRMED' : 'LINE_SUBMIT_NOT_OBSERVED';`,
  `        let pastedCleared = false;\n        let textCleared = !text.trim();\n        for (let i = 0; i < 80; i++) {\n          await new Promise(resolve => setTimeout(resolve, 250));\n          const pastedCount = document.querySelectorAll(pastedSelector).length;\n          pastedCleared = pastedCount === 0;\n          if (!textCleared) {\n            const currentText = (Array.isArray(host.value) ? host.value : [host.value])\n              .filter(value => typeof value === 'string')\n              .join('')\n              .trim();\n            textCleared = currentText.length === 0;\n          }\n          if (pastedCleared && textCleared) return 'SENT';\n        }\n        return pastedCleared ? 'LINE_TEXT_NOT_CLEARED' : 'LINE_SUBMIT_NOT_OBSERVED';`,
  'LINE submit completion from consumed editor state');

ui = replaceOnce(ui,
  `        const baselineIds = new Set(\${JSON.stringify(beforeIds || [])});\n        const expected = Number(\${JSON.stringify(expectedImages || 0)});`,
  `        const expected = Number(\${JSON.stringify(expectedImages || 0)});`,
  'remove blocking LINE message id baseline');

fs.writeFileSync('ui/app.js', ui);

const patchedUi = fs.readFileSync('ui/app.js', 'utf8');
const patchedMain = fs.readFileSync('src/main.cjs', 'utf8');
const patchedTranslation = fs.readFileSync('ui/translation-adapters.js', 'utf8');
for (const required of [
  'submitPastedImages: (msg, beforeIds, expectedImages) =>',
  'textStableChecks >= 3',
  'TEXT_STATE_NOT_READY',
  'requestAnimationFrame(() => requestAnimationFrame(resolve))',
  'pastedCleared && textCleared',
  "return pastedCleared ? 'LINE_TEXT_NOT_CLEARED' : 'LINE_SUBMIT_NOT_OBSERVED'",
  'for (let i = 0; i < 80; i++)',
]) if (!patchedUi.includes(required)) throw new Error(`ui V8 patch missing: ${required}`);
for (const forbidden of ['LINE_MESSAGE_NOT_CONFIRMED', 'addedIds.length >= requiredNew', 'const baselineIds = new Set', "return 'TEXT_SET_FAILED'"]) {
  if (patchedUi.includes(forbidden)) throw new Error(`old blocking V7 completion remains: ${forbidden}`);
}
for (const required of ['pastedImageList-module__image_list_item__', 'DOM.setFileInputFiles', 'PASTE_DISPATCHED']) {
  if (!patchedMain.includes(required)) throw new Error(`LINE V8 send path missing: ${required}`);
}
if (!patchedTranslation.includes("pathname.match(/^\\/[^/]+\\/([^/]+)\\/?$/)")) throw new Error('accepted LINE translation route fix missing');
console.log('LINE_ATTACHMENT_VALIDATION_V8_PATCH_OK');

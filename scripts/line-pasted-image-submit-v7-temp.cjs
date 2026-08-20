'use strict';

require('./line-attachment-transaction-v6-temp.cjs');

const fs = require('node:fs');

function replaceOnce(text, before, after, label) {
  const normalizedText = text.replace(/\r\n/g, '\n');
  const normalizedBefore = before.replace(/\r\n/g, '\n');
  const count = normalizedText.split(normalizedBefore).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}`);
  return normalizedText.replace(normalizedBefore, after);
}

let main = fs.readFileSync('src/main.cjs', 'utf8');
main = replaceOnce(main,
  `      const before = await send('Runtime.evaluate', {\n        expression: \`document.querySelectorAll('[class*="sendFilelistItem-module__send_file_item__"]').length\`,\n        returnByValue: true\n      });\n      const lineFileCount = Number(before?.result?.value || 0);`,
  `      const before = await send('Runtime.evaluate', {\n        expression: \`document.querySelectorAll('[class*="pastedImageList-module__image_list_item__"]').length\`,\n        returnByValue: true\n      });\n      const linePastedImageCount = Number(before?.result?.value || 0);`,
  'LINE pasted image baseline');
main = replaceOnce(main,
  `            const modal = document.querySelector('[class*="sendFileModal-module__modal__"]');\n            const count = modal ? modal.querySelectorAll('[class*="sendFilelistItem-module__send_file_item__"]').length : 0;\n            return JSON.stringify({ present: !!modal, count });`,
  `            const count = document.querySelectorAll('[class*="pastedImageList-module__image_list_item__"]').length;\n            return JSON.stringify({ count });`,
  'LINE pasted image readiness observation');
main = replaceOnce(main,
  `        if (state.present && Number(state.count || 0) > lineFileCount) {\n          return true;\n        }\n        await new Promise(resolve => setTimeout(resolve, 250));\n      }\n      return 'LINE_FILE_ITEM_NOT_READY';`,
  `        if (Number(state.count || 0) > linePastedImageCount) {\n          await send('Runtime.evaluate', { expression: \`document.getElementById('__geek_line_file_input')?.remove(); true\`, returnByValue: true });\n          return true;\n        }\n        await new Promise(resolve => setTimeout(resolve, 250));\n      }\n      await send('Runtime.evaluate', { expression: \`document.getElementById('__geek_line_file_input')?.remove(); true\`, returnByValue: true });\n      return 'LINE_PASTED_IMAGE_NOT_READY';`,
  'LINE pasted image readiness gate');
fs.writeFileSync('src/main.cjs', main);

let ui = fs.readFileSync('ui/app.js', 'utf8');
const lineStart = ui.indexOf('    line: {');
if (lineStart < 0) throw new Error('LINE adapter not found');
const lineSendAnchor = "      send: `(async () => {";
const lineSendAt = ui.indexOf(lineSendAnchor, lineStart);
if (lineSendAt < 0) throw new Error('LINE send anchor not found');
const submitPastedImages = `      submitPastedImages: (msg, beforeIds, expectedImages) => \`(async () => {\n        const baselineIds = new Set(\${JSON.stringify(beforeIds || [])});\n        const expected = Number(\${JSON.stringify(expectedImages || 0)});\n        if (!Number.isFinite(expected) || expected < 1) return 'INVALID_IMAGE_COUNT';\n        const pastedSelector = '[class*="pastedImageList-module__image_list_item__"]';\n        const pastedBeforeSubmit = document.querySelectorAll(pastedSelector).length;\n        if (pastedBeforeSubmit < expected) return 'LINE_PASTED_IMAGE_NOT_READY';\n        const text = \${JSON.stringify(msg)};\n        const host = document.querySelector('textarea-ex[class*="chatroomEditor-module__textarea__"]');\n        const textarea = host?.shadowRoot?.querySelector('textarea');\n        if (!host || !textarea || typeof host.insertValue !== 'function') return 'NO_EDITOR';\n        if (text.trim()) {\n          textarea.focus();\n          document.execCommand('selectAll', false, null);\n          host.insertValue([text]);\n          const actual = (Array.isArray(host.value) ? host.value : [host.value]).filter(value => typeof value === 'string').join('').trim();\n          if (actual !== text.trim()) return 'TEXT_SET_FAILED';\n        }\n        textarea.focus();\n        textarea.dispatchEvent(new KeyboardEvent('keydown', {\n          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,\n          altKey: true, metaKey: true, bubbles: true, cancelable: true, composed: true\n        }));\n        const requiredNew = expected + (text.trim() ? 1 : 0);\n        let pastedCleared = false;\n        for (let i = 0; i < 240; i++) {\n          await new Promise(resolve => setTimeout(resolve, 250));\n          const pastedCount = document.querySelectorAll(pastedSelector).length;\n          if (pastedCount === 0) pastedCleared = true;\n          const currentIds = [...document.querySelectorAll('[class*="message-module__message__"][data-mid]')].map(el => el.getAttribute('data-mid')).filter(Boolean);\n          const addedIds = currentIds.filter(id => !baselineIds.has(id));\n          if (pastedCleared && addedIds.length >= requiredNew) return 'SENT';\n        }\n        return pastedCleared ? 'LINE_MESSAGE_NOT_CONFIRMED' : 'LINE_SUBMIT_NOT_OBSERVED';\n      })()\`,\n`;
ui = ui.slice(0, lineSendAt) + submitPastedImages + ui.slice(lineSendAt);

const oldLineBranch = `            if (platform.family === 'line') {\n              if (typeof adapter.sendAttachment !== 'function') { sentOk = 'ERR:LINE附件发送适配器缺失'; break; }\n              const lineReadyRaw = await wv.executeJavaScript(\`(() => {\n                const modal = document.querySelector('[class*="sendFileModal-module__modal__"]');\n                const itemCount = modal?.querySelectorAll('[class*="sendFilelistItem-module__send_file_item__"]').length || 0;\n                return JSON.stringify({\n                  ok: !!modal && itemCount > 0,\n                  itemCount,\n                  ids: [...document.querySelectorAll('[class*="message-module__message__"][data-mid]')].map(el => el.getAttribute('data-mid')).filter(Boolean)\n                });\n              })()\`);\n              let lineReady = {};\n              try { lineReady = JSON.parse(lineReadyRaw || '{}'); } catch { lineReady = {}; }\n              if (!lineReady.ok) { sentOk = 'NO_FILE_SEND_BUTTON'; break; }\n              const sendProbeFile = broadcastFiles[0];\n              const clickResult = await window.api.broadcast.dropFile({\n                partition: account.partition,\n                filePath: sendProbeFile.filePath,\n                mime: sendProbeFile.mime,\n                platform: familyOf(account.type).key,\n                action: 'send',\n                guestId: wv.getWebContentsId()\n              });\n              if (clickResult !== 'SEND_CLICK_DISPATCHED') { sentOk = clickResult || 'FILE_SEND_CLICK_FAILED'; break; }\n              sentOk = await wv.executeJavaScript(adapter.sendAttachment(personalMsg, Array.isArray(lineReady.ids) ? lineReady.ids : []));\n              break;\n            }`;
const newLineBranch = `            if (platform.family === 'line') {\n              if (typeof adapter.submitPastedImages !== 'function') { sentOk = 'ERR:LINE粘贴图片发送适配器缺失'; break; }\n              const lineReadyRaw = await wv.executeJavaScript(\`(() => JSON.stringify({\n                pastedCount: document.querySelectorAll('[class*="pastedImageList-module__image_list_item__"]').length,\n                ids: [...document.querySelectorAll('[class*="message-module__message__"][data-mid]')].map(el => el.getAttribute('data-mid')).filter(Boolean)\n              }))()\`);\n              let lineReady = {};\n              try { lineReady = JSON.parse(lineReadyRaw || '{}'); } catch { lineReady = {}; }\n              if (Number(lineReady.pastedCount || 0) < broadcastFiles.length) { sentOk = 'LINE_PASTED_IMAGE_NOT_READY'; break; }\n              sentOk = await wv.executeJavaScript(adapter.submitPastedImages(\n                personalMsg,\n                Array.isArray(lineReady.ids) ? lineReady.ids : [],\n                broadcastFiles.length\n              ));\n              break;\n            }`;
ui = replaceOnce(ui, oldLineBranch, newLineBranch, 'LINE pasted image native submit branch');
fs.writeFileSync('ui/app.js', ui);

const patchedMain = fs.readFileSync('src/main.cjs', 'utf8');
const patchedUi = fs.readFileSync('ui/app.js', 'utf8');
const patchedTranslation = fs.readFileSync('ui/translation-adapters.js', 'utf8');
for (const required of ['pastedImageList-module__image_list_item__', 'linePastedImageCount', 'LINE_PASTED_IMAGE_NOT_READY', 'DOM.setFileInputFiles', 'PASTE_DISPATCHED', "targetPlatform === 'line' ? guestId : null"]) {
  if (!patchedMain.includes(required)) throw new Error(`main V7 patch missing: ${required}`);
}
for (const required of ['submitPastedImages: (msg, beforeIds, expectedImages) =>', 'pastedBeforeSubmit', 'LINE_SUBMIT_NOT_OBSERVED', 'LINE_MESSAGE_NOT_CONFIRMED', 'altKey: true, metaKey: true', 'broadcastFiles.length']) {
  if (!patchedUi.includes(required)) throw new Error(`ui V7 patch missing: ${required}`);
}
if (patchedUi.includes("action: 'send',\n                guestId: wv.getWebContentsId()")) throw new Error('old LINE modal send action remains reachable');
if (patchedUi.includes("sentOk = await wv.executeJavaScript(adapter.sendAttachment(personalMsg")) throw new Error('old LINE modal send adapter remains reachable');
if (!patchedTranslation.includes("pathname.match(/^\\/[^/]+\\/([^/]+)\\/?$/)")) throw new Error('accepted LINE translation route fix missing');
console.log('LINE_ATTACHMENT_VALIDATION_V7_PATCH_OK');

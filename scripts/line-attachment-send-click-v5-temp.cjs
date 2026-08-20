'use strict';

require('./line-attachment-send-click-v4-temp.cjs');

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
  `            const modal = document.querySelector('[class*="sendFileModal-module__modal__"]');\n            if (!modal) return JSON.stringify({ ok: false, count: 0 });\n            const items = [...modal.querySelectorAll('[class*="sendFilelistItem-module__send_file_item__"]')];\n            const sendBtn = modal.querySelector('[class*="sendFileModal-module__button_send__"]');\n            return JSON.stringify({ ok: !!sendBtn && !sendBtn.disabled, count: items.length });`,
  `            const modal = document.querySelector('[class*="sendFileModal-module__modal__"]');\n            return JSON.stringify({ present: !!modal });`,
  'LINE panel presence detection');
main = replaceOnce(main,
  `        if (state.ok && Number(state.count || 0) > lineFileCount) {`,
  `        if (state.present) {`,
  'LINE panel presence gate');
main = replaceOnce(main,
  `      if (!state.ok) return state.reason || 'NO_FILE_SEND_BUTTON';\n      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: state.x, y: state.y });\n      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: state.x, y: state.y, button: 'left', buttons: 1, clickCount: 1 });\n      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: state.x, y: state.y, button: 'left', buttons: 0, clickCount: 1 });\n      return 'SEND_CLICK_DISPATCHED';`,
  `      if (!state.ok) {\n        for (let attempt = 0; attempt < 80; attempt++) {\n          await new Promise(resolve => setTimeout(resolve, 250));\n          const retry = await send('Runtime.evaluate', {\n            expression: \`(() => {\n              const modal = document.querySelector('[class*="sendFileModal-module__modal__"]');\n              const sendButton = modal?.querySelector('[class*="sendFileModal-module__button_send__"]');\n              if (!modal || !sendButton || sendButton.disabled) return JSON.stringify({ ok: false });\n              const rect = sendButton.getBoundingClientRect();\n              return JSON.stringify({ ok: rect.width > 0 && rect.height > 0, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) });\n            })()\`,\n            returnByValue: true\n          });\n          try { state = JSON.parse(retry?.result?.value || '{}'); } catch { state = {}; }\n          if (state.ok) break;\n        }\n      }\n      if (!state.ok) return 'FILE_SEND_BUTTON_NOT_READY';\n      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: state.x, y: state.y });\n      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: state.x, y: state.y, button: 'left', buttons: 1, clickCount: 1 });\n      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: state.x, y: state.y, button: 'left', buttons: 0, clickCount: 1 });\n      return 'SEND_CLICK_DISPATCHED';`,
  'LINE wait for send button');
fs.writeFileSync('src/main.cjs', main);

let ui = fs.readFileSync('ui/app.js', 'utf8');
ui = replaceOnce(ui,
  '      sendAttachment: (msg, fileBefore) => `',
  '      sendAttachment: (msg, beforeIds) => `',
  'LINE attachment id baseline signature');
ui = replaceOnce(ui,
  `        const baselineCount = Number(fileBefore);\n        if (!Number.isFinite(baselineCount) || baselineCount < 0) return 'INVALID_FILE_BASELINE';\n        let fileSent = false;`,
  `        const baselineIds = new Set(\${JSON.stringify(beforeIds || [])});\n        let fileSent = false;`,
  'LINE attachment id baseline');
ui = replaceOnce(ui,
  `          const messageAdded = document.querySelectorAll('[class*="message-module__message__"][data-mid]').length > baselineCount;`,
  `          const currentIds = [...document.querySelectorAll('[class*="message-module__message__"][data-mid]')].map(el => el.getAttribute('data-mid')).filter(Boolean);\n          const messageAdded = currentIds.some(id => !baselineIds.has(id));`,
  'LINE attachment id confirmation');
ui = replaceOnce(ui,
  `                const sendButton = modal?.querySelector('[class*="sendFileModal-module__button_send__"]');\n                return JSON.stringify({\n                  ok: !!modal && !!sendButton && !sendButton.disabled,\n                  count: document.querySelectorAll('[class*="message-module__message__"][data-mid]').length\n                });`,
  `                return JSON.stringify({\n                  ok: !!modal,\n                  ids: [...document.querySelectorAll('[class*="message-module__message__"][data-mid]')].map(el => el.getAttribute('data-mid')).filter(Boolean)\n                });`,
  'LINE renderer panel gate');
ui = replaceOnce(ui,
  `sentOk = await wv.executeJavaScript(adapter.sendAttachment(personalMsg, Number(lineReady.count || 0)));`,
  `sentOk = await wv.executeJavaScript(adapter.sendAttachment(personalMsg, Array.isArray(lineReady.ids) ? lineReady.ids : []));`,
  'LINE attachment id invocation');
fs.writeFileSync('ui/app.js', ui);

const patchedMain = fs.readFileSync('src/main.cjs', 'utf8');
const patchedUi = fs.readFileSync('ui/app.js', 'utf8');
const patchedTranslation = fs.readFileSync('ui/translation-adapters.js', 'utf8');
for (const required of ['present: !!modal','FILE_SEND_BUTTON_NOT_READY','DOM.setFileInputFiles','Input.dispatchMouseEvent','SEND_CLICK_DISPATCHED']) if (!patchedMain.includes(required)) throw new Error(`main V5 patch missing: ${required}`);
for (const required of ['sendAttachment: (msg, beforeIds) =>','baselineIds = new Set','currentIds.some(id => !baselineIds.has(id))','Array.isArray(lineReady.ids) ? lineReady.ids : []']) if (!patchedUi.includes(required)) throw new Error(`ui V5 patch missing: ${required}`);
if (patchedUi.includes('ok: !!modal && !!sendButton && !sendButton.disabled')) throw new Error('old renderer readiness gate remains');
if (patchedUi.includes('sendButton.click();')) throw new Error('synthetic LINE file send click remains');
if (!patchedTranslation.includes("pathname.match(/^\\/[^/]+\\/([^/]+)\\/?$/)")) throw new Error('accepted LINE translation route fix missing');
console.log('LINE_ATTACHMENT_VALIDATION_V5_PATCH_OK');

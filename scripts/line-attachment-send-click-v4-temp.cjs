'use strict';

require('./line-attachment-static-probe-temp.cjs');

const fs = require('node:fs');

function replaceOnce(text, before, after, label) {
  const normalizedText = text.replace(/\r\n/g, '\n');
  const normalizedBefore = before.replace(/\r\n/g, '\n');
  const count = normalizedText.split(normalizedBefore).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}`);
  return normalizedText.replace(normalizedBefore, after);
}

let main = fs.readFileSync('src/main.cjs', 'utf8');
main = replaceOnce(
  main,
  "  async function dropFileViaCdp({ send }, { filePath, mime, pos, platform }) {\n    if (platform === 'line') {",
  `  async function dropFileViaCdp({ send }, { filePath, mime, pos, platform, action }) {\n    if (platform === 'line' && action === 'send') {\n      const point = await send('Runtime.evaluate', {\n        expression: \`(() => {\n          const modal = document.querySelector('[class*="sendFileModal-module__modal__"]');\n          const sendButton = modal?.querySelector('[class*="sendFileModal-module__button_send__"]');\n          if (!modal || !sendButton || sendButton.disabled) return JSON.stringify({ ok: false, reason: 'NO_FILE_SEND_BUTTON' });\n          const rect = sendButton.getBoundingClientRect();\n          if (!rect || rect.width <= 0 || rect.height <= 0) return JSON.stringify({ ok: false, reason: 'FILE_SEND_BUTTON_NOT_VISIBLE' });\n          return JSON.stringify({\n            ok: true,\n            x: Math.round(rect.left + rect.width / 2),\n            y: Math.round(rect.top + rect.height / 2)\n          });\n        })()\`,\n        returnByValue: true\n      });\n      let state = {};\n      try { state = JSON.parse(point?.result?.value || '{}'); } catch { state = {}; }\n      if (!state.ok) return state.reason || 'NO_FILE_SEND_BUTTON';\n      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: state.x, y: state.y });\n      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: state.x, y: state.y, button: 'left', buttons: 1, clickCount: 1 });\n      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: state.x, y: state.y, button: 'left', buttons: 0, clickCount: 1 });\n      return 'SEND_CLICK_DISPATCHED';\n    }\n    if (platform === 'line') {`,
  'LINE trusted send click'
);
main = replaceOnce(
  main,
  '    const { partition, filePath, mime, platform } = payload || {};',
  '    const { partition, filePath, mime, platform, action } = payload || {};',
  'LINE drop action payload'
);
main = replaceOnce(
  main,
  'return await withExternalCdpSend(wsUrl, ({ send }) => dropFileViaCdp({ send }, { filePath, mime, pos, platform: targetPlatform }));',
  'return await withExternalCdpSend(wsUrl, ({ send }) => dropFileViaCdp({ send }, { filePath, mime, pos, platform: targetPlatform, action }));',
  'external LINE send action'
);
main = replaceOnce(
  main,
  'return await internalCdp.run(partition, targetPlatform, ({ send }) => dropFileViaCdp({ send }, { filePath, mime, pos, platform: targetPlatform }));',
  'return await internalCdp.run(partition, targetPlatform, ({ send }) => dropFileViaCdp({ send }, { filePath, mime, pos, platform: targetPlatform, action }));',
  'internal LINE send action'
);
fs.writeFileSync('src/main.cjs', main);

let ui = fs.readFileSync('ui/app.js', 'utf8');
ui = replaceOnce(
  ui,
  '      sendAttachment: (msg) => `',
  '      sendAttachment: (msg, fileBefore) => `',
  'LINE attachment confirmation baseline signature'
);
ui = replaceOnce(
  ui,
  `        const modal = document.querySelector('[class*="sendFileModal-module__modal__"]');\n        const sendButton = modal?.querySelector('[class*="sendFileModal-module__button_send__"]');\n        if (!modal || !sendButton || sendButton.disabled) return 'NO_FILE_SEND_BUTTON';\n        const fileBefore = document.querySelectorAll('[class*="message-module__message__"][data-mid]').length;\n        sendButton.click();\n        let fileSent = false;`,
  `        const baselineCount = Number(fileBefore);\n        if (!Number.isFinite(baselineCount) || baselineCount < 0) return 'INVALID_FILE_BASELINE';\n        let fileSent = false;`,
  'remove synthetic LINE send click'
);
ui = replaceOnce(
  ui,
  "          const messageAdded = document.querySelectorAll('[class*=\"message-module__message__\"][data-mid]').length > fileBefore;",
  "          const messageAdded = document.querySelectorAll('[class*=\"message-module__message__\"][data-mid]').length > baselineCount;",
  'LINE attachment confirmation count'
);
ui = replaceOnce(
  ui,
  `            if (platform.family === 'line') {\n              if (typeof adapter.sendAttachment !== 'function') { sentOk = 'ERR:LINE附件发送适配器缺失'; break; }\n              sentOk = await wv.executeJavaScript(adapter.sendAttachment(personalMsg));\n              break;\n            }`,
  `            if (platform.family === 'line') {\n              if (typeof adapter.sendAttachment !== 'function') { sentOk = 'ERR:LINE附件发送适配器缺失'; break; }\n              const lineReadyRaw = await wv.executeJavaScript(\`(() => {\n                const modal = document.querySelector('[class*="sendFileModal-module__modal__"]');\n                const sendButton = modal?.querySelector('[class*="sendFileModal-module__button_send__"]');\n                return JSON.stringify({\n                  ok: !!modal && !!sendButton && !sendButton.disabled,\n                  count: document.querySelectorAll('[class*="message-module__message__"][data-mid]').length\n                });\n              })()\`);\n              let lineReady = {};\n              try { lineReady = JSON.parse(lineReadyRaw || '{}'); } catch { lineReady = {}; }\n              if (!lineReady.ok) { sentOk = 'NO_FILE_SEND_BUTTON'; break; }\n              const sendProbeFile = broadcastFiles[0];\n              const clickResult = await window.api.broadcast.dropFile({\n                partition: account.partition,\n                filePath: sendProbeFile.filePath,\n                mime: sendProbeFile.mime,\n                platform: familyOf(account.type).key,\n                action: 'send'\n              });\n              if (clickResult !== 'SEND_CLICK_DISPATCHED') { sentOk = clickResult || 'FILE_SEND_CLICK_FAILED'; break; }\n              sentOk = await wv.executeJavaScript(adapter.sendAttachment(personalMsg, Number(lineReady.count || 0)));\n              break;\n            }`,
  'LINE trusted click invocation'
);
fs.writeFileSync('ui/app.js', ui);

const patchedMain = fs.readFileSync('src/main.cjs', 'utf8');
const patchedUi = fs.readFileSync('ui/app.js', 'utf8');
const patchedTranslation = fs.readFileSync('ui/translation-adapters.js', 'utf8');
for (const required of [
  "action === 'send'",
  'Input.dispatchMouseEvent',
  'SEND_CLICK_DISPATCHED',
  'FILE_SEND_BUTTON_NOT_VISIBLE',
  'DOM.setFileInputFiles',
  'PASTE_DISPATCHED',
]) if (!patchedMain.includes(required)) throw new Error(`main V4 patch missing: ${required}`);
for (const required of [
  "action: 'send'",
  'baselineCount',
  'FILE_SEND_CLICK_FAILED',
  'sendAttachment(personalMsg, Number(lineReady.count || 0))',
]) if (!patchedUi.includes(required)) throw new Error(`ui V4 patch missing: ${required}`);
if (patchedUi.includes('sendButton.click();')) throw new Error('synthetic LINE file send click remains');
if (!patchedTranslation.includes("pathname.match(/^\\/[^/]+\\/([^/]+)\\/?$/)")) throw new Error('accepted LINE translation route fix missing');
if (patchedTranslation.includes("location.hash || '').match(/\\/chats\\/")) throw new Error('legacy LINE route matcher remains');

console.log('LINE_ATTACHMENT_VALIDATION_V4_PATCH_OK');

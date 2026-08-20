'use strict';

require('./line-attachment-send-click-v5-temp.cjs');

const fs = require('node:fs');

function replaceOnce(text, before, after, label) {
  const normalizedText = text.replace(/\r\n/g, '\n');
  const normalizedBefore = before.replace(/\r\n/g, '\n');
  const count = normalizedText.split(normalizedBefore).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}`);
  return normalizedText.replace(normalizedBefore, after);
}

let cdp = fs.readFileSync('src/internal-cdp.cjs', 'utf8');
cdp = replaceOnce(cdp,
  `  function findGuest(partition, platform) {\n    const partitionLeaf = partition.split(':').pop();\n    const guests = getAllWebContents();\n    return guests.find(g => {\n      const gPartition = storagePathLeaf(g?.session?.storagePath);\n      return gPartition === partitionLeaf && isPlatformUrl(g.getURL(), platform);\n    }) || null;\n  }`,
  `  function findGuest(partition, platform, preferredGuestId = null) {\n    const partitionLeaf = partition.split(':').pop();\n    const guests = getAllWebContents();\n    const matches = (g) => {\n      const gPartition = storagePathLeaf(g?.session?.storagePath);\n      return gPartition === partitionLeaf && isPlatformUrl(g.getURL(), platform);\n    };\n    if (preferredGuestId !== null && preferredGuestId !== undefined) {\n      const exact = guests.find(g => Number(g?.id) === Number(preferredGuestId));\n      return exact && matches(exact) ? exact : null;\n    }\n    return guests.find(matches) || null;\n  }`,
  'exact preferred guest selection');
cdp = replaceOnce(cdp,
  `  async function run(partition, platform, callback) {`,
  `  async function run(partition, platform, callback, preferredGuestId = null) {`,
  'preferred guest run signature');
cdp = replaceOnce(cdp,
  `    const guest = findGuest(partition, platform);`,
  `    const guest = findGuest(partition, platform, preferredGuestId);`,
  'preferred guest run lookup');
fs.writeFileSync('src/internal-cdp.cjs', cdp);

let main = fs.readFileSync('src/main.cjs', 'utf8');
main = replaceOnce(main,
  `    const { partition, filePath, mime, platform, action } = payload || {};`,
  `    const { partition, filePath, mime, platform, action, guestId } = payload || {};`,
  'LINE guest id payload');
main = replaceOnce(main,
  `return await internalCdp.run(partition, targetPlatform, ({ send }) => dropFileViaCdp({ send }, { filePath, mime, pos, platform: targetPlatform, action }));`,
  `return await internalCdp.run(partition, targetPlatform, ({ send }) => dropFileViaCdp({ send }, { filePath, mime, pos, platform: targetPlatform, action }), targetPlatform === 'line' ? guestId : null);`,
  'LINE exact guest invocation');
main = replaceOnce(main,
  `            const modal = document.querySelector('[class*="sendFileModal-module__modal__"]');\n            return JSON.stringify({ present: !!modal });`,
  `            const modal = document.querySelector('[class*="sendFileModal-module__modal__"]');\n            const count = modal ? modal.querySelectorAll('[class*="sendFilelistItem-module__send_file_item__"]').length : 0;\n            return JSON.stringify({ present: !!modal, count });`,
  'LINE file item readiness observation');
main = replaceOnce(main,
  `        if (state.present) {\n          await send('Runtime.evaluate', { expression: \`document.getElementById('__geek_line_file_input')?.remove(); true\`, returnByValue: true });\n          return true;\n        }\n        await new Promise(resolve => setTimeout(resolve, 150));\n      }\n      await send('Runtime.evaluate', { expression: \`document.getElementById('__geek_line_file_input')?.remove(); true\`, returnByValue: true });\n      return false;`,
  `        if (state.present && Number(state.count || 0) > lineFileCount) {\n          return true;\n        }\n        await new Promise(resolve => setTimeout(resolve, 250));\n      }\n      return 'LINE_FILE_ITEM_NOT_READY';`,
  'LINE wait for real file item and retain input');
main = replaceOnce(main,
  `      for (let attempt = 0; attempt < 40; attempt++) {`,
  `      for (let attempt = 0; attempt < 120; attempt++) {`,
  'LINE attachment readiness timeout');
main = replaceOnce(main,
  `          const sendButton = modal?.querySelector('[class*="sendFileModal-module__button_send__"]');\n          if (!modal || !sendButton || sendButton.disabled) return JSON.stringify({ ok: false, reason: 'NO_FILE_SEND_BUTTON' });\n          const rect = sendButton.getBoundingClientRect();`,
  `          const sendButton = modal?.querySelector('[class*="sendFileModal-module__button_send__"]');\n          const itemCount = modal?.querySelectorAll('[class*="sendFilelistItem-module__send_file_item__"]').length || 0;\n          if (!modal || !sendButton) return JSON.stringify({ ok: false, reason: 'NO_FILE_SEND_BUTTON' });\n          if (itemCount <= 0) return JSON.stringify({ ok: false, reason: 'LINE_FILE_ITEM_NOT_READY' });\n          const rect = sendButton.getBoundingClientRect();`,
  'LINE initial send requires file item');
main = replaceOnce(main,
  `              const sendButton = modal?.querySelector('[class*="sendFileModal-module__button_send__"]');\n              if (!modal || !sendButton || sendButton.disabled) return JSON.stringify({ ok: false });\n              const rect = sendButton.getBoundingClientRect();`,
  `              const sendButton = modal?.querySelector('[class*="sendFileModal-module__button_send__"]');\n              const itemCount = modal?.querySelectorAll('[class*="sendFilelistItem-module__send_file_item__"]').length || 0;\n              if (!modal || !sendButton || itemCount <= 0) return JSON.stringify({ ok: false });\n              const rect = sendButton.getBoundingClientRect();`,
  'LINE retry send requires file item');
main = replaceOnce(main,
  `      if (!state.ok) return 'FILE_SEND_BUTTON_NOT_READY';\n      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: state.x, y: state.y });\n      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: state.x, y: state.y, button: 'left', buttons: 1, clickCount: 1 });\n      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: state.x, y: state.y, button: 'left', buttons: 0, clickCount: 1 });\n      return 'SEND_CLICK_DISPATCHED';`,
  `      if (!state.ok) return state.reason || 'LINE_FILE_ITEM_NOT_READY';\n      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: state.x, y: state.y });\n      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: state.x, y: state.y, button: 'left', buttons: 1, clickCount: 1 });\n      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: state.x, y: state.y, button: 'left', buttons: 0, clickCount: 1 });\n      await send('Runtime.evaluate', { expression: \`document.getElementById('__geek_line_file_input')?.remove(); true\`, returnByValue: true });\n      return 'SEND_CLICK_DISPATCHED';`,
  'LINE send cleanup and stage result');
fs.writeFileSync('src/main.cjs', main);

let ui = fs.readFileSync('ui/app.js', 'utf8');
ui = replaceOnce(ui,
  `const dropped = await window.api.broadcast.dropFile({ partition: account.partition, filePath: file.filePath, mime: file.mime, platform: familyOf(account.type).key });`,
  `const dropped = await window.api.broadcast.dropFile({ partition: account.partition, filePath: file.filePath, mime: file.mime, platform: familyOf(account.type).key, guestId: platform.family === 'line' ? wv.getWebContentsId() : undefined });`,
  'LINE injection exact guest id');
ui = replaceOnce(ui,
  `                if (dropped !== true) {\n                  attachmentReady = false;\n                  failReasons.push(\`\${t.name}: 文件未进入发送面板\`);\n                  break;\n                }`,
  `                if (dropped !== true) {\n                  attachmentReady = false;\n                  const attachmentStage = platform.family === 'line' && typeof dropped === 'string' ? dropped : '文件未进入发送面板';\n                  failReasons.push(\`\${t.name}: \${attachmentStage}\`);\n                  break;\n                }`,
  'LINE staged attachment failure');
ui = replaceOnce(ui,
  `                const modal = document.querySelector('[class*="sendFileModal-module__modal__"]');\n                return JSON.stringify({\n                  ok: !!modal,\n                  ids: [...document.querySelectorAll('[class*="message-module__message__"][data-mid]')].map(el => el.getAttribute('data-mid')).filter(Boolean)\n                });`,
  `                const modal = document.querySelector('[class*="sendFileModal-module__modal__"]');\n                const itemCount = modal?.querySelectorAll('[class*="sendFilelistItem-module__send_file_item__"]').length || 0;\n                return JSON.stringify({\n                  ok: !!modal && itemCount > 0,\n                  itemCount,\n                  ids: [...document.querySelectorAll('[class*="message-module__message__"][data-mid]')].map(el => el.getAttribute('data-mid')).filter(Boolean)\n                });`,
  'LINE renderer file item gate');
ui = replaceOnce(ui,
  `                action: 'send'\n              });`,
  `                action: 'send',\n                guestId: wv.getWebContentsId()\n              });`,
  'LINE send exact guest id');
fs.writeFileSync('ui/app.js', ui);

const patchedCdp = fs.readFileSync('src/internal-cdp.cjs', 'utf8');
const patchedMain = fs.readFileSync('src/main.cjs', 'utf8');
const patchedUi = fs.readFileSync('ui/app.js', 'utf8');
const patchedTranslation = fs.readFileSync('ui/translation-adapters.js', 'utf8');
for (const required of ['preferredGuestId', 'Number(g?.id) === Number(preferredGuestId)', 'findGuest(partition, platform, preferredGuestId)']) if (!patchedCdp.includes(required)) throw new Error(`internal CDP V6 patch missing: ${required}`);
for (const required of ['guestId', 'LINE_FILE_ITEM_NOT_READY', 'itemCount <= 0', 'attempt < 120', "targetPlatform === 'line' ? guestId : null"]) if (!patchedMain.includes(required)) throw new Error(`main V6 patch missing: ${required}`);
for (const required of ['guestId: platform.family === \'line\' ? wv.getWebContentsId() : undefined', 'guestId: wv.getWebContentsId()', 'attachmentStage', 'itemCount > 0']) if (!patchedUi.includes(required)) throw new Error(`ui V6 patch missing: ${required}`);
if (patchedMain.includes("if (!modal || !sendButton || sendButton.disabled)")) throw new Error('LINE disabled-button readiness gate remains');
if (patchedMain.includes('if (state.present) {')) throw new Error('LINE modal-only readiness gate remains');
if (!patchedTranslation.includes("pathname.match(/^\\/[^/]+\\/([^/]+)\\/?$/)")) throw new Error('accepted LINE translation route fix missing');
console.log('LINE_ATTACHMENT_VALIDATION_V6_PATCH_OK');

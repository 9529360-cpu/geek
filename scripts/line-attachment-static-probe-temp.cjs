'use strict';

const fs = require('node:fs');

function replaceOnce(text, before, after, label) {
  const normalizedText = text.replace(/\r\n/g, '\n');
  const normalizedBefore = before.replace(/\r\n/g, '\n');
  const count = normalizedText.split(normalizedBefore).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}`);
  return normalizedText.replace(normalizedBefore, after);
}

const bundle = fs.readFileSync('resources/extensions/line-3.5.1/static/js/main.js', 'utf8');
for (const evidence of [
  "'data-is-dropzone': !0",
  'sendFileModal-module__modal__ZD4Jo',
  'sendFileModal-module__button_send__IQKjX',
  'onClickSend: ee',
  'clipboardData.files',
]) {
  if (!bundle.includes(evidence)) throw new Error(`missing bundled LINE attachment evidence: ${evidence}`);
}

let main = fs.readFileSync('src/main.cjs', 'utf8');
main = replaceOnce(
  main,
  "  async function dropFileViaCdp({ send }, { filePath, mime, pos }) {\n    const dragData = {",
  `  async function dropFileViaCdp({ send }, { filePath, mime, pos, platform }) {\n    let lineFileCount = 0;\n    if (platform === 'line') {\n      const before = await send('Runtime.evaluate', { expression: \`document.querySelectorAll('[class*="sendFilelistItem-module__send_file_item__"]').length\`, returnByValue: true });\n      lineFileCount = Number(before?.result?.value || 0);\n    }\n    const dragData = {`,
  'dropFileViaCdp signature'
);
main = replaceOnce(
  main,
  `    // 验证弹窗\n    const chk = await send('Runtime.evaluate', { expression: \`(() => {\n      const modalBtn = [...document.querySelectorAll('.modal-dialog button, .modal-container button')].find(b => /primary/.test((b.className || '').toString()));\n      return modalBtn ? 'MODAL_OK' : 'NO_MODAL';\n    })()\`, returnByValue: true });\n    return chk?.result?.value === 'MODAL_OK';`,
  `    // LINE 使用自己的文件列表/发送面板；Telegram 保持原有确认弹窗。\n    if (platform === 'line') {\n      for (let attempt = 0; attempt < 40; attempt++) {\n        const chk = await send('Runtime.evaluate', { expression: \`(() => {\n          const modal = document.querySelector('[class*="sendFileModal-module__modal__"]');\n          if (!modal) return JSON.stringify({ ok: false, count: 0 });\n          const items = [...modal.querySelectorAll('[class*="sendFilelistItem-module__send_file_item__"]')];\n          const sendBtn = modal.querySelector('[class*="sendFileModal-module__button_send__"]');\n          const unsupported = items.some(item => item.getAttribute('data-file-support') === 'false');\n          return JSON.stringify({ ok: !!sendBtn && !sendBtn.disabled && !unsupported, count: items.length });\n        })()\`, returnByValue: true });\n        let state = {};\n        try { state = JSON.parse(chk?.result?.value || '{}'); } catch { state = {}; }\n        if (state.ok && Number(state.count || 0) > lineFileCount) return true;\n        await new Promise(resolve => setTimeout(resolve, 150));\n      }\n      return false;\n    }\n    const chk = await send('Runtime.evaluate', { expression: \`(() => {\n      const modalBtn = [...document.querySelectorAll('.modal-dialog button, .modal-container button')].find(b => /primary/.test((b.className || '').toString()));\n      return modalBtn ? 'MODAL_OK' : 'NO_MODAL';\n    })()\`, returnByValue: true });\n    return chk?.result?.value === 'MODAL_OK';`,
  'platform modal verification'
);
main = replaceOnce(main, '  async function getDropPos(partition) {', '  async function getDropPos(partition, platform) {', 'getDropPos signature');
main = replaceOnce(
  main,
  `        const res = await wc.executeJavaScript(\`(() => {\n          const ed = document.querySelector('.form-control.ProseMirror') || document.querySelector('[contenteditable="true"]');\n          if (!ed) return null;\n          const rect = ed.getBoundingClientRect();\n          return JSON.stringify({ x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });\n        })()\`);`,
  `        const res = await wc.executeJavaScript(\`(() => {\n          const family = \${JSON.stringify(platform || '')};\n          const ed = family === 'line'\n            ? (document.querySelector('[class*="sendFileModal-module__modal__"][data-is-dropzone="true"]')\n              || document.querySelector('[class*="sendFileModal-module__modal__"]')\n              || [...document.querySelectorAll('[data-is-dropzone="true"]')].find(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0; })\n              || document.querySelector('textarea-ex[class*="chatroomEditor-module__textarea__"]'))\n            : (document.querySelector('.form-control.ProseMirror') || document.querySelector('[contenteditable="true"]'));\n          if (!ed) return null;\n          const rect = ed.getBoundingClientRect();\n          return JSON.stringify({ x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });\n        })()\`);`,
  'platform drop position'
);
main = replaceOnce(main, '    const pos = await getDropPos(partition);', '    const pos = await getDropPos(partition, targetPlatform);', 'drop position call');
main = replaceOnce(
  main,
  'return await withExternalCdpSend(wsUrl, ({ send }) => dropFileViaCdp({ send }, { filePath, mime, pos }));',
  'return await withExternalCdpSend(wsUrl, ({ send }) => dropFileViaCdp({ send }, { filePath, mime, pos, platform: targetPlatform }));',
  'external drop platform'
);
main = replaceOnce(
  main,
  'return await internalCdp.run(partition, targetPlatform, ({ send }) => dropFileViaCdp({ send }, { filePath, mime, pos }));',
  'return await internalCdp.run(partition, targetPlatform, ({ send }) => dropFileViaCdp({ send }, { filePath, mime, pos, platform: targetPlatform }));',
  'internal drop platform'
);
fs.writeFileSync('src/main.cjs', main);

let ui = fs.readFileSync('ui/app.js', 'utf8');
const lineStart = ui.indexOf('    line: {');
if (lineStart < 0) throw new Error('LINE adapter not found');
const lineSendAnchor = "      send: `(async () => {";
const lineSendAt = ui.indexOf(lineSendAnchor, lineStart);
if (lineSendAt < 0) throw new Error('LINE send anchor not found');
const sendAttachment = `      sendAttachment: (msg) => \`(async () => {\n        const modal = document.querySelector('[class*="sendFileModal-module__modal__"]');\n        const sendButton = modal?.querySelector('[class*="sendFileModal-module__button_send__"]');\n        if (!modal || !sendButton || sendButton.disabled) return 'NO_FILE_SEND_BUTTON';\n        const fileBefore = document.querySelectorAll('[class*="message-module__message__"][data-mid]').length;\n        sendButton.click();\n        let fileSent = false;\n        for (let i = 0; i < 80; i++) {\n          await new Promise(resolve => setTimeout(resolve, 250));\n          const modalGone = !document.querySelector('[class*="sendFileModal-module__modal__"]');\n          const messageAdded = document.querySelectorAll('[class*="message-module__message__"][data-mid]').length > fileBefore;\n          if (modalGone && messageAdded) { fileSent = true; break; }\n        }\n        if (!fileSent) return 'FILE_SEND_NOT_CONFIRMED';\n        const text = \${JSON.stringify(msg)};\n        if (!text.trim()) return 'SENT';\n        const host = document.querySelector('textarea-ex[class*="chatroomEditor-module__textarea__"]');\n        const textarea = host?.shadowRoot?.querySelector('textarea');\n        if (!host || !textarea || typeof host.insertValue !== 'function') return 'NO_EDITOR';\n        const textBefore = document.querySelectorAll('[class*="message-module__message__"][data-mid]').length;\n        textarea.focus();\n        document.execCommand('selectAll', false, null);\n        host.insertValue([text]);\n        const actual = (Array.isArray(host.value) ? host.value : [host.value]).filter(value => typeof value === 'string').join('').trim();\n        if (actual !== text.trim()) return 'TEXT_SET_FAILED';\n        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true }));\n        for (let i = 0; i < 60; i++) {\n          await new Promise(resolve => setTimeout(resolve, 250));\n          const value = (Array.isArray(host.value) ? host.value : [host.value]).filter(v => typeof v === 'string').join('').trim();\n          if (document.querySelectorAll('[class*="message-module__message__"][data-mid]').length > textBefore && !value) return 'SENT';\n        }\n        return 'TEXT_SEND_NOT_CONFIRMED';\n      })()\`,\n`;
ui = ui.slice(0, lineSendAt) + sendAttachment + ui.slice(lineSendAt);

ui = replaceOnce(
  ui,
  `            for (const file of broadcastFiles) {\n              try {\n                await window.api.broadcast.dropFile({ partition: account.partition, filePath: file.filePath, mime: file.mime, platform: familyOf(account.type).key });\n                await sleep(3000); // 等 TG 弹"Send 1 Files"窗口\n              } catch (e) { failReasons.push(\`\${t.name}: 文件注入失败 \${e.message}\`); }\n            }\n            // 文字消息：由 send 输入到弹窗 caption（弹窗会遮挡主输入框）\n            sentOk = await wv.executeJavaScript(adapter.send(personalMsg)); // 弹窗 caption + Send`,
  `            let attachmentReady = true;\n            for (const file of broadcastFiles) {\n              try {\n                const dropped = await window.api.broadcast.dropFile({ partition: account.partition, filePath: file.filePath, mime: file.mime, platform: familyOf(account.type).key });\n                if (dropped !== true) {\n                  attachmentReady = false;\n                  failReasons.push(\`\${t.name}: 文件未进入发送面板\`);\n                  break;\n                }\n                await sleep(platform.family === 'line' ? 500 : 3000);\n              } catch (e) {\n                attachmentReady = false;\n                failReasons.push(\`\${t.name}: 文件注入失败 \${e.message}\`);\n                break;\n              }\n            }\n            if (!attachmentReady) {\n              sentOk = 'ERR:附件未进入发送面板';\n              if (platform.family === 'line') break;\n              continue;\n            }\n            if (platform.family === 'line') {\n              if (typeof adapter.sendAttachment !== 'function') { sentOk = 'ERR:LINE附件发送适配器缺失'; break; }\n              sentOk = await wv.executeJavaScript(adapter.sendAttachment(personalMsg));\n              break; // LINE 文件已进入发送队列后不自动重试，避免重复图片。\n            }\n            // Telegram：文字由发送弹窗 caption 处理。\n            sentOk = await wv.executeJavaScript(adapter.send(personalMsg));`,
  'fail-closed attachment branch'
);
fs.writeFileSync('ui/app.js', ui);

// Keep the already authenticated-and-accepted LINE translation route fix in this validation installer.
let translation = fs.readFileSync('ui/translation-adapters.js', 'utf8');
translation = replaceOnce(
  translation,
  "    const chatId = () => { try { return decodeURIComponent((String(location.hash || '').match(/\\/chats\\/([^/?]+)/) || [])[1] || ''); } catch { return ''; } };",
  `    const chatId = () => {\n      try {\n        const pathname = String(location.hash || '').replace(/^#/, '').split('?')[0];\n        const match = pathname.match(/^\\/[^/]+\\/([^/]+)\\/?$/);\n        return match ? decodeURIComponent(match[1]) : '';\n      } catch { return ''; }\n    };`,
  'accepted LINE translation route fix'
);
fs.writeFileSync('ui/translation-adapters.js', translation);

const patchedMain = fs.readFileSync('src/main.cjs', 'utf8');
const patchedUi = fs.readFileSync('ui/app.js', 'utf8');
const patchedTranslation = fs.readFileSync('ui/translation-adapters.js', 'utf8');
for (const required of [
  "platform === 'line'",
  'sendFileModal-module__button_send__',
  'getDropPos(partition, targetPlatform)',
  'await new Promise(resolve => setTimeout(resolve, 150))',
]) if (!patchedMain.includes(required)) throw new Error(`main patch missing: ${required}`);
if (patchedMain.includes('await sleep(150)')) throw new Error('main patch still references renderer-only sleep helper');
for (const required of [
  'sendAttachment: (msg) =>',
  'FILE_SEND_NOT_CONFIRMED',
  "if (dropped !== true)",
  "platform.family === 'line'",
]) if (!patchedUi.includes(required)) throw new Error(`ui patch missing: ${required}`);
if (!patchedTranslation.includes("pathname.match(/^\\/[^/]+\\/([^/]+)\\/?$/)")) throw new Error('accepted LINE route matcher missing');
if (patchedTranslation.includes("location.hash || '').match(/\\/chats\\/")) throw new Error('legacy LINE route matcher remains');

console.log('LINE_ATTACHMENT_VALIDATION_PATCH_OK');

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
  'clipboardData.files',
  'onPaste: W',
  'sendFileModal-module__modal__ZD4Jo',
  'sendFileModal-module__button_send__IQKjX',
  'onClickSend: ee',
]) {
  if (!bundle.includes(evidence)) throw new Error(`missing bundled LINE attachment evidence: ${evidence}`);
}

let main = fs.readFileSync('src/main.cjs', 'utf8');
main = replaceOnce(
  main,
  "  async function dropFileViaCdp({ send }, { filePath, mime, pos }) {\n    const dragData = {",
  `  async function dropFileViaCdp({ send }, { filePath, mime, pos, platform }) {\n    if (platform === 'line') {\n      const before = await send('Runtime.evaluate', {\n        expression: \`document.querySelectorAll('[class*="sendFilelistItem-module__send_file_item__"]').length\`,\n        returnByValue: true\n      });\n      const lineFileCount = Number(before?.result?.value || 0);\n      const prepared = await send('Runtime.evaluate', {\n        expression: \`(() => {\n          let input = document.getElementById('__geek_line_file_input');\n          if (!input) {\n            input = document.createElement('input');\n            input.type = 'file';\n            input.id = '__geek_line_file_input';\n            input.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;opacity:0;pointer-events:none';\n            document.documentElement.appendChild(input);\n          }\n          input.value = '';\n          return true;\n        })()\`,\n        returnByValue: true\n      });\n      if (prepared?.result?.value !== true) return false;\n      const documentNode = await send('DOM.getDocument', { depth: 1, pierce: true });\n      const inputNode = await send('DOM.querySelector', {\n        nodeId: documentNode?.root?.nodeId,\n        selector: '#__geek_line_file_input'\n      });\n      if (!inputNode?.nodeId) return false;\n      await send('DOM.setFileInputFiles', { files: [filePath], nodeId: inputNode.nodeId });\n      const pasted = await send('Runtime.evaluate', {\n        expression: \`(() => {\n          const input = document.getElementById('__geek_line_file_input');\n          const file = input?.files?.[0];\n          const host = document.querySelector('textarea-ex[class*="chatroomEditor-module__textarea__"]');\n          const target = host?.shadowRoot?.querySelector('textarea') || host;\n          if (!file || !host || !target) return 'NO_FILE_OR_EDITOR';\n          const event = new Event('paste', { bubbles: true, cancelable: true, composed: true });\n          Object.defineProperty(event, 'clipboardData', {\n            value: { files: input.files, getData: () => '' },\n            configurable: true\n          });\n          target.dispatchEvent(event);\n          return 'PASTE_DISPATCHED';\n        })()\`,\n        returnByValue: true\n      });\n      if (pasted?.result?.value !== 'PASTE_DISPATCHED') return false;\n      for (let attempt = 0; attempt < 40; attempt++) {\n        const chk = await send('Runtime.evaluate', {\n          expression: \`(() => {\n            const modal = document.querySelector('[class*="sendFileModal-module__modal__"]');\n            if (!modal) return JSON.stringify({ ok: false, count: 0 });\n            const items = [...modal.querySelectorAll('[class*="sendFilelistItem-module__send_file_item__"]')];\n            const sendBtn = modal.querySelector('[class*="sendFileModal-module__button_send__"]');\n            return JSON.stringify({ ok: !!sendBtn && !sendBtn.disabled, count: items.length });\n          })()\`,\n          returnByValue: true\n        });\n        let state = {};\n        try { state = JSON.parse(chk?.result?.value || '{}'); } catch { state = {}; }\n        if (state.ok && Number(state.count || 0) > lineFileCount) {\n          await send('Runtime.evaluate', { expression: \`document.getElementById('__geek_line_file_input')?.remove(); true\`, returnByValue: true });\n          return true;\n        }\n        await new Promise(resolve => setTimeout(resolve, 150));\n      }\n      await send('Runtime.evaluate', { expression: \`document.getElementById('__geek_line_file_input')?.remove(); true\`, returnByValue: true });\n      return false;\n    }\n    const dragData = {`,
  'LINE paste attachment transport'
);
main = replaceOnce(
  main,
  '    const pos = await getDropPos(partition);',
  "    const pos = targetPlatform === 'line' ? { x: 1, y: 1 } : await getDropPos(partition);",
  'LINE bypasses drag position'
);
main = replaceOnce(
  main,
  'return await withExternalCdpSend(wsUrl, ({ send }) => dropFileViaCdp({ send }, { filePath, mime, pos }));',
  'return await withExternalCdpSend(wsUrl, ({ send }) => dropFileViaCdp({ send }, { filePath, mime, pos, platform: targetPlatform }));',
  'external attachment platform'
);
main = replaceOnce(
  main,
  'return await internalCdp.run(partition, targetPlatform, ({ send }) => dropFileViaCdp({ send }, { filePath, mime, pos }));',
  'return await internalCdp.run(partition, targetPlatform, ({ send }) => dropFileViaCdp({ send }, { filePath, mime, pos, platform: targetPlatform }));',
  'internal attachment platform'
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
  `            let attachmentReady = true;\n            for (const file of broadcastFiles) {\n              try {\n                const dropped = await window.api.broadcast.dropFile({ partition: account.partition, filePath: file.filePath, mime: file.mime, platform: familyOf(account.type).key });\n                if (dropped !== true) {\n                  attachmentReady = false;\n                  failReasons.push(\`\${t.name}: 文件未进入发送面板\`);\n                  break;\n                }\n                await sleep(platform.family === 'line' ? 500 : 3000);\n              } catch (e) {\n                attachmentReady = false;\n                failReasons.push(\`\${t.name}: 文件注入失败 \${e.message}\`);\n                break;\n              }\n            }\n            if (!attachmentReady) {\n              sentOk = 'ERR:附件未进入发送面板';\n              if (platform.family === 'line') break;\n              continue;\n            }\n            if (platform.family === 'line') {\n              if (typeof adapter.sendAttachment !== 'function') { sentOk = 'ERR:LINE附件发送适配器缺失'; break; }\n              sentOk = await wv.executeJavaScript(adapter.sendAttachment(personalMsg));\n              break;\n            }\n            // Telegram keeps the existing drag/drop + modal path.\n            sentOk = await wv.executeJavaScript(adapter.send(personalMsg));`,
  'fail-closed attachment branch'
);
fs.writeFileSync('ui/app.js', ui);

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
  'DOM.setFileInputFiles',
  'PASTE_DISPATCHED',
  'clipboardData',
  'sendFileModal-module__button_send__',
  "targetPlatform === 'line' ? { x: 1, y: 1 }",
  'await new Promise(resolve => setTimeout(resolve, 150))',
]) if (!patchedMain.includes(required)) throw new Error(`main patch missing: ${required}`);
if (patchedMain.includes('getDropPos(partition, targetPlatform)')) throw new Error('old LINE drag-position patch remains');
for (const required of [
  'sendAttachment: (msg) =>',
  'FILE_SEND_NOT_CONFIRMED',
  "if (dropped !== true)",
  "platform.family === 'line'",
]) if (!patchedUi.includes(required)) throw new Error(`ui patch missing: ${required}`);
if (!patchedTranslation.includes("pathname.match(/^\\/[^/]+\\/([^/]+)\\/?$/)")) throw new Error('accepted LINE route matcher missing');
if (patchedTranslation.includes("location.hash || '').match(/\\/chats\\/")) throw new Error('legacy LINE route matcher remains');

console.log('LINE_ATTACHMENT_VALIDATION_V3_PATCH_OK');

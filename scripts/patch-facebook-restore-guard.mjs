import fs from 'node:fs';

const adapterPath = 'ui/facebook-translation-adapter.js';
const testPath = 'test/facebook-translation-contract.cjs';
let adapter = fs.readFileSync(adapterPath, 'utf8');
let test = fs.readFileSync(testPath, 'utf8');

function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`missing patch anchor: ${label}`);
  return source.replace(from, to);
}

adapter = replaceOnce(adapter,
`    const isVisible = node => {\n      if (!(node instanceof Element) || !node.isConnected) return false;\n      const rect = node.getBoundingClientRect();\n      const style = getComputedStyle(node);\n      return rect.width > 1 && rect.height > 1 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';\n    };\n\n    const currentChatId = () => {`,
`    const isVisible = node => {\n      if (!(node instanceof Element) || !node.isConnected) return false;\n      const rect = node.getBoundingClientRect();\n      const style = getComputedStyle(node);\n      return rect.width > 1 && rect.height > 1 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';\n    };\n\n    // Facebook 的 PIN/一次性代码/安全存储恢复属于 Messenger 自己的阻塞式流程。\n    // 这类弹窗存在时，翻译层必须完全静默：不扫描消息、不改 DOM、不拦截发送。\n    // 只判断可见模态框的几何特征，不读取、记录或上传 PIN/验证码/聊天内容。\n    const hasBlockingDialog = () => {\n      const candidates = document.querySelectorAll('[aria-modal="true"],[role="dialog"]');\n      for (const node of candidates) {\n        if (!(node instanceof Element) || !isVisible(node)) continue;\n        const rect = node.getBoundingClientRect();\n        const minWidth = Math.min(320, innerWidth * 0.35);\n        const minHeight = Math.min(180, innerHeight * 0.20);\n        if (rect.width >= minWidth && rect.height >= minHeight) return true;\n      }\n      return false;\n    };\n\n    const currentChatId = () => {`,
'blocking dialog helper');

adapter = replaceOnce(adapter,
`    const scan = (scope, mode = 'new') => {\n      if (generation !== window.__geekFacebookTranslationGeneration || !currentChatId()) return;`,
`    const scan = (scope, mode = 'new') => {\n      if (generation !== window.__geekFacebookTranslationGeneration || !currentChatId() || hasBlockingDialog()) return;`,
'scan dialog guard');

adapter = replaceOnce(adapter,
`    window.__geekFacebookTranslationObserver = new MutationObserver(records => {\n      const mode = Date.now() < settleUntil ? 'history' : 'new';\n      for (const record of records) {\n        for (const added of record.addedNodes) {\n          if (added.nodeType === 1) scan(added, mode);\n        }\n      }\n    });`,
`    window.__geekFacebookTranslationObserver = new MutationObserver(records => {\n      // Messenger 恢复加密聊天时 React 会高频重建 DOM。此时只让 Facebook 自己工作，\n      // 避免翻译扫描触发布局读取或插入译文，干扰 PIN/一次性代码恢复流程。\n      if (hasBlockingDialog()) return;\n      const mode = Date.now() < settleUntil ? 'history' : 'new';\n      let sawRemoval = false;\n      for (const record of records) {\n        if (record.removedNodes?.length) sawRemoval = true;\n        for (const added of record.addedNodes) {\n          if (added.nodeType === 1) scan(added, mode);\n        }\n      }\n      // 模态框关闭本身通常只有 removedNodes；补扫一次当前聊天即可恢复翻译。\n      if (sawRemoval) scheduleScan(mode);\n    });`,
'observer dialog guard');

adapter = replaceOnce(adapter,
`    const translateAndSend = async (event, editor, button) => {\n      if (window.__geekFacebookSendLock) return;`,
`    const translateAndSend = async (event, editor, button) => {\n      if (window.__geekFacebookSendLock || hasBlockingDialog()) return;`,
'send dialog guard');

const insertBefore = `assert.match(adapterSource, /MutationObserver/,\n  'Facebook 动态消息列表必须由 MutationObserver 跟踪');`;
if (!test.includes(insertBefore)) throw new Error('missing test insertion anchor');
test = test.replace(insertBefore,
`assert.match(adapterSource, /function|const hasBlockingDialog[\\s\\S]*?aria-modal=\\"true\\"[\\s\\S]*?role=\\"dialog\\"/,\n  'Facebook PIN/安全存储恢复弹窗存在时必须识别阻塞式模态框');\nassert.match(adapterSource, /const scan = \\(scope, mode = 'new'\\) => \\{[\\s\\S]{0,220}hasBlockingDialog\\(\\)/,\n  '阻塞式恢复弹窗存在时不得扫描或改写消息 DOM');\nassert.match(adapterSource, /translateAndSend = async[\\s\\S]{0,180}hasBlockingDialog\\(\\)/,\n  '阻塞式恢复弹窗存在时不得拦截发送动作');\nassert.doesNotMatch(adapterSource, /hasBlockingDialog[\\s\\S]{0,800}(?:innerText|textContent)/,\n  '阻塞检测不得读取 PIN/验证码或聊天文本内容');\n\n${insertBefore}`);

fs.writeFileSync(adapterPath, adapter);
fs.writeFileSync(testPath, test);
console.log('FACEBOOK_RESTORE_GUARD_PATCH_OK');

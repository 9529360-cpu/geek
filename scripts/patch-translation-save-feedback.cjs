'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`${label}: anchor missing`);
  if (source.indexOf(needle, first + needle.length) >= 0) throw new Error(`${label}: anchor not unique`);
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

const uxPath = path.join(root, 'ui', 'translation-settings.js');
let ux = fs.readFileSync(uxPath, 'utf8');

ux = replaceOnce(
  ux,
  "    const statusTimers = new Map();\n",
  "    const statusTimers = new Map();\n    const saveQueues = new Map();\n    const saveRevisions = new Map();\n",
  'save feedback state'
);

ux = replaceOnce(
  ux,
`    function setStatus(id, text, kind = '') {\n      const node = el(id);\n      if (!node) return;\n      node.textContent = text;\n      node.dataset.state = kind;\n      const old = statusTimers.get(id);\n      if (old) clearTimeout(old);\n      if (kind === 'ok') {\n        statusTimers.set(id, setTimeout(() => {\n          if (node.dataset.state === 'ok') { node.textContent = ''; node.dataset.state = ''; }\n        }, 1800));\n      }\n    }\n\n    function populateLanguages() {\n`,
`    function setStatus(id, text, kind = '') {\n      const node = el(id);\n      if (!node) return;\n      node.textContent = text;\n      node.dataset.state = kind;\n      const old = statusTimers.get(id);\n      if (old) clearTimeout(old);\n      if (kind === 'ok') {\n        statusTimers.set(id, setTimeout(() => {\n          if (node.dataset.state === 'ok') { node.textContent = ''; node.dataset.state = ''; }\n        }, 2200));\n      }\n    }\n\n    function enqueueSave(scope, task) {\n      const previous = saveQueues.get(scope) || Promise.resolve();\n      const next = previous.catch(() => {}).then(task);\n      saveQueues.set(scope, next);\n      return next;\n    }\n\n    async function persistStorage({ scope, statusId, key, payload, workingText = '正在保存…', successText = '已保存 ✓', failureText = '保存失败，请重试', onLatestSuccess, onLatestFailure }) {\n      const revision = (saveRevisions.get(scope) || 0) + 1;\n      saveRevisions.set(scope, revision);\n      setStatus(statusId, workingText, 'working');\n      let ok = false;\n      try {\n        const result = await enqueueSave(scope, () => deps.setStorage(key, payload));\n        ok = result !== false;\n      } catch {\n        ok = false;\n      }\n      if (ok) deps.sync();\n      if (saveRevisions.get(scope) !== revision) return ok;\n      if (!ok) {\n        if (typeof onLatestFailure === 'function') await onLatestFailure();\n        setStatus(statusId, failureText, 'error');\n        return false;\n      }\n      if (typeof onLatestSuccess === 'function') await onLatestSuccess();\n      setStatus(statusId, successText, 'ok');\n      return true;\n    }\n\n    function populateLanguages() {\n`,
  'status and save queue helpers'
);

ux = replaceOnce(
  ux,
`    async function saveGlobal() {\n      if (!deps.getActiveId()) return false;\n      const cfg = collectGlobal();\n      setValue('translation-message', cfg.translationMode);\n      syncDependencies(cfg);\n      const result = await deps.setStorage('translationGlobal', JSON.stringify(cfg));\n      if (result === false) {\n        refreshGlobal();\n        setStatus('translation-global-status', '保存失败，请重试', 'error');\n        return false;\n      }\n      deps.sync();\n      setStatus('translation-global-status', '已保存 ✓', 'ok');\n      await refreshChat();\n      return true;\n    }\n`,
`    async function saveGlobal() {\n      if (!deps.getActiveId()) return false;\n      const cfg = collectGlobal();\n      setValue('translation-message', cfg.translationMode);\n      syncDependencies(cfg);\n      return persistStorage({\n        scope: 'global',\n        statusId: 'translation-global-status',\n        key: 'translationGlobal',\n        payload: JSON.stringify(cfg),\n        onLatestFailure: () => { refreshGlobal(); },\n        onLatestSuccess: () => refreshChat()\n      });\n    }\n`,
  'global autosave'
);

ux = replaceOnce(
  ux,
`    async function persistChats(store, successText) {\n      const result = await deps.setStorage('translationChats', JSON.stringify(store));\n      if (result === false) {\n        setStatus('translation-chat-status', '保存失败，请重试', 'error');\n        await refreshChat();\n        return false;\n      }\n      deps.sync();\n      setStatus('translation-chat-status', successText || '已保存 ✓', 'ok');\n      await refreshChat();\n      return true;\n    }\n`,
`    async function persistChats(store, successText) {\n      return persistStorage({\n        scope: 'chat',\n        statusId: 'translation-chat-status',\n        key: 'translationChats',\n        payload: JSON.stringify(store),\n        successText: successText || '已保存 ✓',\n        onLatestFailure: () => refreshChat(),\n        onLatestSuccess: () => refreshChat()\n      });\n    }\n`,
  'chat autosave'
);

ux = replaceOnce(
  ux,
`    async function resetGlobalDefaults() {\n      if (!deps.getActiveId()) return false;\n      const ask = typeof deps.confirm === 'function' ? deps.confirm : window.confirm.bind(window);\n      if (!ask('恢复全局翻译推荐设置？当前聊天的单独设置会保留。')) return false;\n      setStatus('translation-global-status', '正在恢复…', 'working');\n      const result = await deps.setStorage('translationGlobal', JSON.stringify(DEFAULTS));\n      if (result === false) {\n        setStatus('translation-global-status', '恢复失败，请重试', 'error');\n        refreshGlobal();\n        return false;\n      }\n      deps.sync();\n      refreshGlobal();\n      await refreshChat();\n      setStatus('translation-global-status', '翻译设置已恢复默认 ✓', 'ok');\n      return true;\n    }\n`,
`    async function resetGlobalDefaults() {\n      if (!deps.getActiveId()) return false;\n      const ask = typeof deps.confirm === 'function' ? deps.confirm : window.confirm.bind(window);\n      if (!ask('恢复全局翻译推荐设置？当前聊天的单独设置会保留。')) return false;\n      return persistStorage({\n        scope: 'global',\n        statusId: 'translation-global-status',\n        key: 'translationGlobal',\n        payload: JSON.stringify(DEFAULTS),\n        workingText: '正在恢复…',\n        successText: '翻译设置已恢复默认 ✓',\n        failureText: '恢复失败，请重试',\n        onLatestFailure: () => { refreshGlobal(); },\n        onLatestSuccess: async () => { refreshGlobal(); await refreshChat(); }\n      });\n    }\n`,
  'global reset queue'
);

fs.writeFileSync(uxPath, ux);

const cssPath = path.join(root, 'ui', 'translation-settings.css');
let css = fs.readFileSync(cssPath, 'utf8');
css = replaceOnce(
  css,
  ".translation-save-status[data-state='ok'] { color: var(--accent); }\n",
  ".translation-save-status[data-state='working'] { color: var(--text-secondary); }\n.translation-save-status[data-state='ok'] { color: var(--accent); }\n",
  'working feedback style'
);
fs.writeFileSync(cssPath, css);

const contract = `'use strict';\nconst assert = require('node:assert/strict');\nconst fs = require('node:fs');\nconst path = require('node:path');\n\nconst root = path.resolve(__dirname, '..');\nconst ux = fs.readFileSync(path.join(root, 'ui', 'translation-settings.js'), 'utf8');\nconst css = fs.readFileSync(path.join(root, 'ui', 'translation-settings.css'), 'utf8');\n\nassert.match(ux, /const saveQueues = new Map\\(\\)/, '翻译保存必须按 scope 维护串行队列');\nassert.match(ux, /const saveRevisions = new Map\\(\\)/, '翻译保存必须用 revision 抑制旧反馈');\nassert.match(ux, /previous\\.catch\\(\\(\\) => \\{\\}\\)\\.then\\(task\\)/, '队列必须在前一写入失败后仍继续处理后续用户操作');\n\nconst persistStart = ux.indexOf('async function persistStorage(');\nconst persistEnd = ux.indexOf('function populateLanguages()', persistStart);\nassert.ok(persistStart >= 0 && persistEnd > persistStart, '必须存在聚焦的持久化反馈 helper');\nconst persist = ux.slice(persistStart, persistEnd);\nassert.match(persist, /setStatus\\(statusId, workingText, 'working'\\)/, '持久化开始必须立即显示 working 状态');\nassert.ok(persist.indexOf("setStatus(statusId, workingText, 'working')") < persist.indexOf('await enqueueSave'), 'working 状态必须早于异步写入');\nassert.match(persist, /try \\{[\\s\\S]*await enqueueSave[\\s\\S]*\\} catch \\{[\\s\\S]*ok = false/, 'setStorage 异常必须转为可见失败');\nassert.match(persist, /saveRevisions\\.get\\(scope\\) !== revision/, '旧请求完成后不得覆盖最新反馈');\nassert.match(persist, /if \\(ok\\) deps\\.sync\\(\\)/, '成功持久化仍必须沿用既有同步语义');\n\nconst globalStart = ux.indexOf('async function saveGlobal()');\nconst globalEnd = ux.indexOf('function setChatUi', globalStart);\nconst globalSave = ux.slice(globalStart, globalEnd);\nassert.match(globalSave, /persistStorage\\(\\{[\\s\\S]*scope: 'global'[\\s\\S]*key: 'translationGlobal'/, '全局自动保存必须走 global 队列');\n\nconst chatsStart = ux.indexOf('async function persistChats(');\nconst chatsEnd = ux.indexOf('async function setChatOverride', chatsStart);\nconst chatsSave = ux.slice(chatsStart, chatsEnd);\nassert.match(chatsSave, /persistStorage\\(\\{[\\s\\S]*scope: 'chat'[\\s\\S]*key: 'translationChats'/, '当前聊天自动保存必须走独立 chat 队列');\n\nconst resetStart = ux.indexOf('async function resetGlobalDefaults()');\nconst resetEnd = ux.indexOf('async function checkHealth', resetStart);\nconst reset = ux.slice(resetStart, resetEnd);\nassert.match(reset, /persistStorage\\(\\{[\\s\\S]*scope: 'global'[\\s\\S]*key: 'translationGlobal'/, '恢复推荐设置必须与全局自动保存共享队列');\nassert.match(reset, /workingText: '正在恢复…'/, '恢复默认必须保留明确进行中反馈');\n\nassert.match(ux, /\\}, 2200\\)\\);/, '成功提示时长必须与普通设置保持一致');\nassert.match(css, /translation-save-status\\[data-state='working'\\]/, '翻译保存必须有 working 状态样式');\n\nconsole.log('TRANSLATION_SAVE_FEEDBACK_CONTRACT_OK');\n`;
fs.writeFileSync(path.join(root, 'test', 'translation-save-feedback-contract.cjs'), contract);

console.log('TRANSLATION_SAVE_FEEDBACK_PATCH_OK');

'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ux = fs.readFileSync(path.join(root, 'ui', 'translation-settings.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'ui', 'translation-settings.css'), 'utf8');

assert.match(ux, /const saveQueues = new Map\(\)/, '翻译保存必须按 scope 维护串行队列');
assert.match(ux, /const saveRevisions = new Map\(\)/, '翻译保存必须用 revision 抑制旧反馈');
assert.match(ux, /previous\.catch\(\(\) => \{\}\)\.then\(task\)/, '队列必须在前一写入失败后仍继续处理后续用户操作');

const persistStart = ux.indexOf('async function persistStorage(');
const persistEnd = ux.indexOf('function populateLanguages()', persistStart);
assert.ok(persistStart >= 0 && persistEnd > persistStart, '必须存在聚焦的持久化反馈 helper');
const persist = ux.slice(persistStart, persistEnd);
assert.match(persist, /setStatus\(statusId, workingText, 'working'\)/, '持久化开始必须立即显示 working 状态');
assert.ok(persist.indexOf("setStatus(statusId, workingText, 'working')") < persist.indexOf('await enqueueSave'), 'working 状态必须早于异步写入');
assert.match(persist, /try \{[\s\S]*await enqueueSave[\s\S]*\} catch \{[\s\S]*ok = false/, 'setStorage 异常必须转为可见失败');
assert.match(persist, /saveRevisions\.get\(scope\) !== revision/, '旧请求完成后不得覆盖最新反馈');
assert.match(persist, /if \(ok\) deps\.sync\(\)/, '成功持久化仍必须沿用既有同步语义');

const globalStart = ux.indexOf('async function saveGlobal()');
const globalEnd = ux.indexOf('function setChatUi', globalStart);
const globalSave = ux.slice(globalStart, globalEnd);
assert.match(globalSave, /persistStorage\(\{[\s\S]*scope: 'global'[\s\S]*key: 'translationGlobal'/, '全局自动保存必须走 global 队列');

const chatsStart = ux.indexOf('async function persistChats(');
const chatsEnd = ux.indexOf('async function setChatOverride', chatsStart);
const chatsSave = ux.slice(chatsStart, chatsEnd);
assert.match(chatsSave, /persistStorage\(\{[\s\S]*scope: 'chat'[\s\S]*key: 'translationChats'/, '当前聊天自动保存必须走独立 chat 队列');

const resetStart = ux.indexOf('async function resetGlobalDefaults()');
const resetEnd = ux.indexOf('async function checkHealth', resetStart);
const reset = ux.slice(resetStart, resetEnd);
assert.match(reset, /persistStorage\(\{[\s\S]*scope: 'global'[\s\S]*key: 'translationGlobal'/, '恢复推荐设置必须与全局自动保存共享队列');
assert.match(reset, /workingText: '正在恢复…'/, '恢复默认必须保留明确进行中反馈');

assert.match(ux, /\}, 2200\)\);/, '成功提示时长必须与普通设置保持一致');
assert.match(css, /translation-save-status\[data-state='working'\]/, '翻译保存必须有 working 状态样式');

console.log('TRANSLATION_SAVE_FEEDBACK_CONTRACT_OK');

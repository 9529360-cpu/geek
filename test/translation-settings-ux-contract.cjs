'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
const ux = fs.readFileSync(path.join(root, 'ui', 'translation-settings.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'ui', 'translation-settings.css'), 'utf8');

assert.match(html, /translation-settings\.css/, '翻译设置必须加载独立 UX 样式层');
assert.match(html, /translation-settings\.js/, '翻译设置必须加载独立 controller，而不是继续膨胀 app.js');
assert.match(html, /data-translation-tab="global">常用设置</, '翻译面板首屏必须是用户任务导向的常用设置');
assert.match(html, /id="translation-receive-auto"[^>]*type="checkbox"|type="checkbox"[^>]*id="translation-receive-auto"/, '收到消息自动翻译必须使用直接开关');
assert.match(html, /id="translation-send"[^>]*type="checkbox"|type="checkbox"[^>]*id="translation-send"/, '发送前自动翻译必须使用直接开关');
assert.match(html, /id="translation-chat-override"[^>]*type="checkbox"|type="checkbox"[^>]*id="translation-chat-override"/, '当前聊天必须明确提供单独设置开关');
assert.match(html, /id="translation-chat-reset"/, '当前聊天必须可以一键恢复全局设置');
assert.match(html, /data-translation-tab="advanced">高级设置</, '低频参数必须收进高级设置');

assert.match(ux, /delete store\[chatId\]/, '恢复全局必须删除当前聊天 override，而不是复制一份全局值');
assert.match(ux, /core\.normalizeConfig\(globalConfig\(\),/, '当前聊天显示必须复用公共配置合并语义');
assert.match(ux, /result === false/, '设置持久化失败必须有显式失败分支，不能静默吞掉');
assert.match(ux, /translationGlobal/, '必须继续复用既有 translationGlobal 数据键');
assert.match(ux, /translationChats/, '必须继续复用既有 translationChats 数据键');
assert.match(ux, /translationMode: receiveAuto \? 'auto' : 'click'/, '关闭自动接收翻译应退化为按需翻译而不是破坏手动能力');
assert.match(ux, /translation-appearance-preview/, '译文外观必须提供固定示例预览');
assert.match(ux, /不读取聊天内容/, '预览必须明确不读取真实聊天内容');
assert.match(ux, /refreshAppearancePreview/, '字号与颜色变化必须即时刷新预览');
assert.match(css, /translation-appearance-preview-text/, '预览必须有独立聚焦样式');
assert.match(app, /GeekTranslationSettings\.create\(/, 'app.js 只负责向独立翻译设置 controller 注入运行时依赖');
assert.match(app, /function refreshTranslationGlobalPanel\(\) \{[\s\S]*translationSettings\.refreshGlobal\(\);/, '旧的账号切换刷新入口必须保持兼容');

assert.ok(css.length < 12000, 'UX 样式层应保持聚焦，避免形成新的巨型样式文件');

const context = { window: {}, document: {}, localStorage: {} };
vm.createContext(context);
vm.runInContext(ux, context, { filename: 'translation-settings.js' });
assert.equal(typeof context.window.GeekTranslationSettings?.create, 'function', '翻译设置 controller 必须可独立加载');
assert.ok(Array.isArray(context.window.GeekTranslationSettings?.LANGUAGES), '语言列表必须由独立 controller 统一提供');

console.log('TRANSLATION_SETTINGS_UX_CONTRACT_OK');

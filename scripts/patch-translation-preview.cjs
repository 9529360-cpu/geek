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

const jsPath = path.join(root, 'ui', 'translation-settings.js');
let js = fs.readFileSync(jsPath, 'utf8');
const refreshAnchor = `    function refreshGlobal() {\n      populateLanguages();\n`;
const previewFns = `    function ensureAppearancePreview() {\n      if (el('translation-appearance-preview')) return;\n      const host = el('translation-font-size')?.closest('.translation-advanced-body');\n      if (!host) return;\n      const preview = document.createElement('div');\n      preview.id = 'translation-appearance-preview';\n      preview.className = 'translation-appearance-preview';\n      const label = document.createElement('div');\n      label.className = 'translation-appearance-preview-label';\n      label.textContent = '效果预览 · 示例内容';\n      const original = document.createElement('div');\n      original.className = 'translation-appearance-preview-original';\n      original.textContent = 'See you tomorrow at 10:00.';\n      const translated = document.createElement('div');\n      translated.id = 'translation-appearance-preview-text';\n      translated.className = 'translation-appearance-preview-text';\n      translated.textContent = '明天 10:00 见。';\n      const note = document.createElement('div');\n      note.className = 'translation-appearance-preview-note';\n      note.textContent = '仅为固定示例，不读取聊天内容，也不会请求翻译服务。';\n      preview.append(label, original, translated, note);\n      host.appendChild(preview);\n    }\n\n    function refreshAppearancePreview(cfg = null) {\n      ensureAppearancePreview();\n      const preview = el('translation-appearance-preview-text');\n      if (!preview) return;\n      const fontSize = String(cfg?.fontSize || value('translation-font-size', '13'));\n      const fontColor = String(cfg?.fontColor || value('translation-font-color', '#667eea'));\n      preview.style.fontSize = /^\\d{1,2}$/.test(fontSize) ? fontSize + 'px' : '13px';\n      preview.style.color = /^#[0-9a-fA-F]{6}$/.test(fontColor) ? fontColor : '#667eea';\n    }\n\n`;
js = replaceOnce(js, refreshAnchor, previewFns + refreshAnchor, 'preview functions');
js = replaceOnce(js,
  `      setValue('translation-font-color', cfg.fontColor || '#667eea');\n      syncDependencies(cfg);`,
  `      setValue('translation-font-color', cfg.fontColor || '#667eea');\n      refreshAppearancePreview(cfg);\n      syncDependencies(cfg);`,
  'refresh preview');
js = replaceOnce(js,
  `        el(id)?.addEventListener('change', () => {\n          if (id === 'translation-receive-auto' && checked(id)) setChecked('translation-display', true);\n          saveGlobal();\n        });`,
  `        el(id)?.addEventListener('change', () => {\n          if (id === 'translation-receive-auto' && checked(id)) setChecked('translation-display', true);\n          if (id === 'translation-font-size' || id === 'translation-font-color') refreshAppearancePreview();\n          saveGlobal();\n        });`,
  'live preview event');
js = replaceOnce(js,
  `      populateLanguages();\n      try { localStorage.removeItem('geekTranslationGateway'); } catch {}`,
  `      populateLanguages();\n      ensureAppearancePreview();\n      refreshAppearancePreview();\n      try { localStorage.removeItem('geekTranslationGateway'); } catch {}`,
  'preview bind');
fs.writeFileSync(jsPath, js);

const cssPath = path.join(root, 'ui', 'translation-settings.css');
let css = fs.readFileSync(cssPath, 'utf8');
if (!css.includes('.translation-appearance-preview {')) {
  css += `\n.translation-appearance-preview { margin-top: 9px; padding: 10px; border: 1px dashed var(--border-standard); border-radius: 9px; background: var(--bg-surface); }\n.translation-appearance-preview-label { color: var(--text-tertiary); font-size: 10.5px; margin-bottom: 7px; }\n.translation-appearance-preview-original { color: var(--text-secondary); font-size: 12px; line-height: 1.45; }\n.translation-appearance-preview-text { margin-top: 4px; line-height: 1.45; transition: color .12s ease, font-size .12s ease; }\n.translation-appearance-preview-note { margin-top: 8px; color: var(--text-quaternary); font-size: 10px; line-height: 1.4; }\n`;
}
fs.writeFileSync(cssPath, css);

const testPath = path.join(root, 'test', 'translation-settings-ux-contract.cjs');
let test = fs.readFileSync(testPath, 'utf8');
const testAnchor = `assert.match(ux, /translationMode: receiveAuto \\? 'auto' : 'click'/, '关闭自动接收翻译应退化为按需翻译而不是破坏手动能力');\n`;
const testExtra = `assert.match(ux, /translation-appearance-preview/, '译文外观必须提供固定示例预览');\nassert.match(ux, /不读取聊天内容/, '预览必须明确不读取真实聊天内容');\nassert.match(ux, /refreshAppearancePreview/, '字号与颜色变化必须即时刷新预览');\nassert.match(css, /translation-appearance-preview-text/, '预览必须有独立聚焦样式');\n`;
test = replaceOnce(test, testAnchor, testAnchor + testExtra, 'preview contract');
fs.writeFileSync(testPath, test);

console.log('TRANSLATION_PREVIEW_PATCH_OK');

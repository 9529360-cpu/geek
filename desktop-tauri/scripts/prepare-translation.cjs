'use strict';
// One shared request/display owner; platform files only read the owned page.
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');
const translationInputs = Object.freeze([
  'src/translation-output-safety.cjs',
  'desktop-tauri/guest/translation-adapter-whatsapp.js',
  'desktop-tauri/guest/translation-telegram-a-incoming.js',
  'desktop-tauri/guest/translation-telegram-k-incoming.js',
  'desktop-tauri/guest/translation-adapter-telegram.js',
  'desktop-tauri/guest/translation.js',
]);

function composeTranslation(root = ROOT) {
  const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
  return ['(function () {', "'use strict';",
    'if (window !== window.top || window.__geekTauriTranslation) return;',
    'const module = { exports: {} };', read(translationInputs[0]),
    'const assessOutput = module.exports.assessTranslationOutput;',
    ...translationInputs.slice(1).map(read), '})();', ''].join('\n');
}

function composeTelegramAObserver(root = ROOT) {
  return ['(function () {', "'use strict';",
    fs.readFileSync(path.join(root, 'desktop-tauri/guest/translation-telegram-a-incoming.js'), 'utf8'),
    'installTelegramAIncomingObserver();', '})();', ''].join('\n');
}

module.exports = { composeTranslation, composeTelegramAObserver, translationInputs };

'use strict';
// Explicit build-time reuse of the product's pure capability/safety contracts.
// No Electron renderer, arbitrary script IPC, legacy retry loop or fork is bundled.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..');
const { composeTranslation, composeTelegramAObserver, translationInputs } = require('./prepare-translation.cjs');

function compose(root = ROOT) {
  const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(read('ui/platform-capabilities.js'), context, { timeout: 1000 });
  vm.runInNewContext(read('ui/platform-adapter-contract.js'), context, { timeout: 1000 });
  vm.runInNewContext(read('ui/platform-transport-definitions.js'), context, { timeout: 1000 });
  const safetyContext = { module: { exports: {} } };
  vm.runInNewContext(read('ui/broadcast-safety.js'), safetyContext, { timeout: 1000 });
  const safety = safetyContext.module.exports;
  const names = ['normalizeChatId', 'sameChat', 'normalizeComposerText', 'authorizeSend'];
  const definitions = context.window.GeekPlatformTransportDefinitions.create();
  const source = [
    '(function () {', "'use strict';",
    'if (window !== window.top || window.__geekTauriPlatform) return;',
    ...names.map((name) => `const ${name} = ${safety[name].toString()};`),
    `const GeekBroadcastSafety = Object.freeze({ ${names.join(', ')} });`,
    `const createPlatformCapabilities = ${context.window.GeekPlatformCapabilities.create.toString()};`,
    `const validateAdapter = ${context.window.GeekPlatformAdapterContract.validate.toString()};`,
    `const readCanonicalChats = async () => (${definitions.definitionFor({ family: 'whatsapp' }).getChats});`,
    read('desktop-tauri/guest/broadcast-attachments.js'),
    read('desktop-tauri/guest/broadcast-audience.js'),
    read('desktop-tauri/guest/broadcast-import.js'),
    read('desktop-tauri/guest/whatsapp.js'),
    read('desktop-tauri/guest/telegram-send-runtime.js'),
    read('desktop-tauri/guest/telegram-send-receipt.js'),
    read('desktop-tauri/guest/telegram-attachments.js'),
    read('desktop-tauri/guest/telegram-audience.js'),
    read('desktop-tauri/guest/telegram-send.js'),
    read('desktop-tauri/guest/bridge.js'),
    '})();', '',
  ].join('\n');
  return source;
}

function composeSend(root = ROOT) {
  const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
  return ['(function () {', "'use strict';",
    'if (window !== window.top || window.__geekTauriSend) return;',
    'const module = { exports: {} };', read('src/translation-output-safety.cjs'),
    'const assessOutput = module.exports.assessTranslationOutput;',
    read('desktop-tauri/guest/whatsapp-reply-context.js'),
    read('desktop-tauri/guest/whatsapp-mentions.js'),
    read('desktop-tauri/guest/whatsapp-caption-media.js'),
    read('desktop-tauri/guest/whatsapp-caption.js'),
    read('desktop-tauri/guest/send-context.js'),
    read('desktop-tauri/guest/send-composer.js'),
    read('desktop-tauri/guest/telegram-send-runtime.js'),
    read('desktop-tauri/guest/telegram-send-receipt.js'),
    read('desktop-tauri/guest/telegram-reply-context.js'),
    read('desktop-tauri/guest/send-composer-telegram.js'),
    read('desktop-tauri/guest/send-view.js'),
    read('desktop-tauri/guest/send.js'), '})();', ''].join('\n');
}

function prepare(output, root = ROOT) {
  const installed = path.join(root, 'node_modules/@wppconnect/wa-js');
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const expected = lock.packages['node_modules/@wppconnect/wa-js'];
  if (!expected?.version || !fs.existsSync(path.join(installed, 'package.json'))) {
    throw new Error('Install locked build assets first: npm ci --ignore-scripts --omit=dev');
  }
  const actual = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'));
  if (actual.version !== expected.version) throw new Error('WA-JS build asset differs from package-lock.json');
  const bundle = fs.readFileSync(path.join(installed, 'dist/wppconnect-wa.js'));
  const guest = compose(root);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'wppconnect-wa.js'), bundle);
  fs.writeFileSync(path.join(output, 'platform-bridge.js'), guest);
  fs.writeFileSync(path.join(output, 'translation-guest.js'), composeTranslation(root));
  fs.writeFileSync(path.join(output, 'telegram-a-observer.js'), composeTelegramAObserver(root));
  fs.writeFileSync(path.join(output, 'send-guest.js'), composeSend(root));
  const licenses = ['LICENSE', 'dist/wppconnect-wa.js.LICENSE.txt'].map((name) =>
    `${name}\n\n${fs.readFileSync(path.join(installed, name), 'utf8')}`).join('\n\n');
  fs.writeFileSync(path.join(output, 'platform-licenses.txt'), licenses);
  const inputs = ['ui/platform-capabilities.js', 'ui/platform-adapter-contract.js',
    'ui/platform-transport-definitions.js', 'ui/broadcast-safety.js',
    'desktop-tauri/guest/broadcast-attachments.js',
    'desktop-tauri/guest/broadcast-audience.js',
    'desktop-tauri/guest/broadcast-import.js',
    'desktop-tauri/guest/whatsapp.js', 'desktop-tauri/guest/bridge.js',
    'desktop-tauri/guest/telegram-send-runtime.js', 'desktop-tauri/guest/telegram-send-receipt.js',
    'desktop-tauri/guest/telegram-reply-context.js',
    'desktop-tauri/guest/telegram-attachments.js',
    'desktop-tauri/guest/telegram-audience.js',
    'desktop-tauri/guest/telegram-send.js', 'desktop-tauri/guest/send-composer-telegram.js',
    ...translationInputs,
    'desktop-tauri/guest/whatsapp-reply-context.js',
    'desktop-tauri/guest/whatsapp-mentions.js',
    'desktop-tauri/guest/whatsapp-caption-media.js',
    'desktop-tauri/guest/whatsapp-caption.js',
    'desktop-tauri/guest/send-context.js', 'desktop-tauri/guest/send-composer.js',
    'desktop-tauri/guest/send-view.js', 'desktop-tauri/guest/send.js'];
  const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');
  const provenance = { waJsVersion: actual.version, waJsIntegrity: expected.integrity,
    bundleSha256: hash(bundle), inputs: Object.fromEntries(inputs.map((name) =>
      [name, hash(fs.readFileSync(path.join(root, name)))])) };
  fs.writeFileSync(path.join(output, 'platform-provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
}

if (require.main === module) {
  if (!process.argv[2]) throw new Error('An explicit Cargo output directory is required');
  prepare(path.resolve(process.argv[2]));
}
module.exports = { compose, composeTranslation, composeSend, prepare };

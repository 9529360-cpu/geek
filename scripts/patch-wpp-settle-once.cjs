'use strict';

const fs = require('node:fs');

const file = 'src/main.cjs';
const source = fs.readFileSync(file, 'utf8');
const anchor = "        await wc.executeJavaScript(wppScript).catch(() => null);";
const occurrences = source.split(anchor).length - 1;
if (occurrences !== 1) {
  throw new Error(`expected exactly one WPP execution anchor, found ${occurrences}`);
}

const waitBlock = `

        // WA-JS 4.5.0 emits loader.injected only after WhatsApp's Meta module
        // graph has settled. WAPLUS embeds an older loader, so starting it before
        // this boundary can run one-shot Store registrars against missing modules.
        const wppMetaSettled = await wc.executeJavaScript(\`(async () => {
          if (window.WPP?.isInjected === true) return true;
          const loader = window.WPP?.loader;
          if (!loader || typeof loader.onInjected !== 'function') return false;
          return await new Promise((resolve) => loader.onInjected(() => resolve(true)));
        })()\`).catch(() => false);
        if (!wppMetaSettled) throw new Error('WPP_META_NOT_SETTLED');`;

const next = source.replace(anchor, anchor + waitBlock);
const official = next.indexOf("../node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js");
const eventGate = next.indexOf("loader.onInjected(() => resolve(true))");
const waplus = next.indexOf("../resources/waplus-wpp.js");
if (!(official >= 0 && eventGate > official && waplus > eventGate)) {
  throw new Error('runtime order must be official WA-JS -> loader.onInjected -> WAPLUS');
}
if ((next.match(/WPP_META_NOT_SETTLED/g) || []).length !== 1) {
  throw new Error('settle failure must have one fail-closed owner');
}

fs.writeFileSync(file, next);

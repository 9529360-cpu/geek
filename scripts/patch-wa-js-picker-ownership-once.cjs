'use strict';

const fs = require('node:fs');

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}`);
  return source.replace(before, after);
}

const mainPath = 'src/main.cjs';
let main = fs.readFileSync(mainPath, 'utf8');
main = replaceOnce(
  main,
  "        wppInjected.add(part);\n        await wc.executeJavaScript(WPP_CAPABILITY_PICKER_SOURCE);\n",
  "        await wc.executeJavaScript(WPP_CAPABILITY_PICKER_SOURCE);\n        wppInjected.add(part);\n",
  'picker-before-ownership',
);
fs.writeFileSync(mainPath, main);

const appPath = 'ui/app.js';
let app = fs.readFileSync(appPath, 'utf8');
app = replaceOnce(
  app,
  "window.__geekPickWpp?.(['whatsapp.UserPrefs','whatsapp.GroupMetadataStore.find','group.create','group.setProperty','contact.getProfilePictureUrl','whatsapp.WidFactory'])",
  "window.__geekPickWpp?.(['whatsapp.UserPrefs','whatsapp.GroupMetadataStore.find','group.create','group.setProperty'])",
  'selected-clone-core-capabilities',
);
app = replaceOnce(
  app,
  "window.__geekPickWpp?.(['group.getGroupInfoFromInviteCode','whatsapp.UserPrefs','whatsapp.GroupMetadataStore.find','group.create','group.setProperty','whatsapp.WidFactory'])",
  "window.__geekPickWpp?.(['group.getGroupInfoFromInviteCode','whatsapp.UserPrefs','whatsapp.GroupMetadataStore.find','group.create','group.setProperty'])",
  'invite-clone-core-capabilities',
);
fs.writeFileSync(appPath, app);

const testPath = 'test/wa-js-460-migration-contract.cjs';
let test = fs.readFileSync(testPath, 'utf8');
test = replaceOnce(
  test,
`const officialBundleIndex = main.indexOf('../node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js', injectionProbeStart);
const injectionOwnerIndex = main.indexOf('wppInjected.add(part)', officialBundleIndex);
const fallbackBundleIndex = main.indexOf('../resources/waplus-wpp.js', injectionOwnerIndex);
assert.ok(officialBundleIndex >= 0 && injectionOwnerIndex > officialBundleIndex && fallbackBundleIndex > injectionOwnerIndex, 'official WA-JS injection ownership must commit before optional WAPLUS compatibility injection');
assert.match(main, /WPP_CAPABILITY_PICKER_SOURCE/, 'main process must own the page capability picker source');
const pickerInstallIndex = main.indexOf('executeJavaScript(WPP_CAPABILITY_PICKER_SOURCE)', injectionOwnerIndex);
assert.ok(pickerInstallIndex > injectionOwnerIndex && pickerInstallIndex < fallbackBundleIndex, 'capability picker must install after official injection ownership and before optional WAPLUS injection');`,
`const officialBundleIndex = main.indexOf('../node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js', injectionProbeStart);
const pickerInstallIndex = main.indexOf('executeJavaScript(WPP_CAPABILITY_PICKER_SOURCE)', officialBundleIndex);
const injectionOwnerIndex = main.indexOf('wppInjected.add(part)', pickerInstallIndex);
const fallbackBundleIndex = main.indexOf('../resources/waplus-wpp.js', injectionOwnerIndex);
assert.match(main, /WPP_CAPABILITY_PICKER_SOURCE/, 'main process must own the page capability picker source');
assert.ok(
  officialBundleIndex >= 0
    && pickerInstallIndex > officialBundleIndex
    && injectionOwnerIndex > pickerInstallIndex
    && fallbackBundleIndex > injectionOwnerIndex,
  'capability picker must install before injection ownership commits, while optional WAPLUS remains post-commit',
);`,
  'migration-ownership-order-oracle',
);
test = replaceOnce(
  test,
  "assert.match(main, /__geekPickWpp\\?\\.\\(\\['whatsapp\\.ChatStore'\\]\\)/, 'main media path must capability-select ChatStore owner');\n",
  "assert.match(main, /__geekPickWpp\\?\\.\\(\\['whatsapp\\.ChatStore'\\]\\)/, 'main media path must capability-select ChatStore owner');\nassert.ok(app.includes(\"__geekPickWpp?.(['whatsapp.UserPrefs','whatsapp.GroupMetadataStore.find','group.create','group.setProperty'])\"), 'selected-group clone picker must gate only core clone capabilities');\nassert.ok(app.includes(\"__geekPickWpp?.(['group.getGroupInfoFromInviteCode','whatsapp.UserPrefs','whatsapp.GroupMetadataStore.find','group.create','group.setProperty'])\"), 'invite-link clone picker must gate only core clone capabilities');\n",
  'clone-core-capability-oracles',
);
fs.writeFileSync(testPath, test);

for (const [file, expected] of [
  [mainPath, 'executeJavaScript(WPP_CAPABILITY_PICKER_SOURCE);\n        wppInjected.add(part);'],
  [appPath, "__geekPickWpp?.(['whatsapp.UserPrefs','whatsapp.GroupMetadataStore.find','group.create','group.setProperty'])"],
  [testPath, 'capability picker must install before injection ownership commits'],
]) {
  if (!fs.readFileSync(file, 'utf8').includes(expected)) throw new Error(`${file}: invariant missing`);
}

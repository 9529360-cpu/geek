'use strict';

const fs = require('node:fs');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function write(file, source) {
  fs.writeFileSync(file, source);
}

function countOf(source, needle) {
  return source.split(needle).length - 1;
}

function replaceOnce(source, before, after, label) {
  const count = countOf(source, before);
  if (count !== 1) throw new Error(`${label}: expected exactly one anchor, found ${count}`);
  return source.replace(before, after);
}

function replaceAfter(source, marker, before, after, label, maxDistance = 8000) {
  const markerCount = countOf(source, marker);
  if (markerCount !== 1) throw new Error(`${label}: marker count=${markerCount}`);
  const markerIndex = source.indexOf(marker);
  const targetIndex = source.indexOf(before, markerIndex + marker.length);
  if (targetIndex < 0 || targetIndex - markerIndex > maxDistance) {
    throw new Error(`${label}: target missing or outside bounded marker window`);
  }
  const nextTarget = source.indexOf(before, targetIndex + before.length);
  if (nextTarget >= 0 && nextTarget - markerIndex <= maxDistance) {
    throw new Error(`${label}: target is ambiguous inside bounded marker window`);
  }
  return source.slice(0, targetIndex) + after + source.slice(targetIndex + before.length);
}

const pickerPath = 'src/wpp-capability-picker.cjs';
write(pickerPath, `'use strict';\n\nfunction installWppCapabilityPicker(target) {\n  if (!target || (typeof target !== 'object' && typeof target !== 'function')) {\n    throw new TypeError('WPP capability picker target is required');\n  }\n\n  const resolvePath = (root, path) => String(path || '')\n    .split('.')\n    .filter(Boolean)\n    .reduce((value, key) => value == null ? undefined : value[key], root);\n\n  target.__geekPickWpp = (requirements = []) => {\n    const paths = (Array.isArray(requirements) ? requirements : [requirements])\n      .map(value => String(value || '').trim())\n      .filter(Boolean);\n    const candidates = [target.WPP, target.WAPLUS_WPP]\n      .filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);\n    if (!paths.length) return candidates[0] || null;\n    return candidates.find(candidate => paths.every(path => resolvePath(candidate, path) != null)) || null;\n  };\n  return true;\n}\n\nconst WPP_CAPABILITY_PICKER_SOURCE = \`(\${installWppCapabilityPicker.toString()})(window)\`;\n\nmodule.exports = {\n  installWppCapabilityPicker,\n  WPP_CAPABILITY_PICKER_SOURCE,\n};\n`);

const mainPath = 'src/main.cjs';
let main = read(mainPath);
main = replaceOnce(
  main,
  "const { normalizeWebsiteUrl } = require('./website-url.cjs');\n",
  "const { normalizeWebsiteUrl } = require('./website-url.cjs');\nconst { WPP_CAPABILITY_PICKER_SOURCE } = require('./wpp-capability-picker.cjs');\n",
  'main picker import',
);
main = replaceAfter(
  main,
  'async function waSendFileViaCdp(send, { filePath, chatId, caption }) {',
  'const wpp = window.WPP || window.WAPLUS_WPP;',
  "const wpp = window.__geekPickWpp?.(['whatsapp.ChatStore']);",
  'main media ChatStore picker',
  5000,
);
main = replaceOnce(
  main,
  "        wppInjected.add(part);\n\n        try {\n",
  "        wppInjected.add(part);\n        await wc.executeJavaScript(WPP_CAPABILITY_PICKER_SOURCE);\n\n        try {\n",
  'main picker installation',
);
write(mainPath, main);

const appPath = 'ui/app.js';
let app = read(appPath);
app = replaceAfter(app, 'const GT_AGENT_SOURCE = `(() => {', 'var W = window.WPP || window.WAPLUS_WPP;', "var W = window.__geekPickWpp?.(['on','off','chat.sendTextMessage','group.getParticipants','whatsapp.UserPrefs']);", 'group agent picker');
app = replaceAfter(app, 'window.__geekMessageFromMe = async function (chatId, messageId) {', 'const api = window.WPP || window.WAPLUS_WPP;', "const api = window.__geekPickWpp?.(['chat.getMessages']);", 'message direction picker');
app = replaceOnce(app, "const activeChat = window.WPP?.chat?.getActiveChat?.() || window.W?.chat?.getActive?.();", "const activeChat = window.__geekPickWpp?.(['chat.getActiveChat'])?.chat?.getActiveChat?.() || window.W?.chat?.getActive?.();", 'active chat picker');
app = replaceAfter(app, '// window.WPP（WA-JS 4.6 主路径）+ window.WAPLUS_WPP（HelloWorld fork，仅作兼容回退）', 'const W = window.WPP || window.WAPLUS_WPP;', "const W = window.__geekPickWpp?.(['chat.list']);", 'broadcast chat-list picker', 1200);
app = replaceAfter(app, 'sendDirect: (chatId, msg, tagall) => `(async () => {', 'const W = window.WPP || window.WAPLUS_WPP;', "const W = window.__geekPickWpp?.(['chat.sendTextMessage']);", 'broadcast text picker');
app = replaceAfter(app, 'sendVcards: (chatId, vcards) => `(async () => {', 'const W = window.WPP || window.WAPLUS_WPP;', "const W = window.__geekPickWpp?.(['chat.sendVCardContactMessage','contact.getPnLidEntry']);", 'vcard picker');
app = replaceAfter(app, 'sendFileDirect: (chatId, file, caption) => `(async () => {', 'const wpp = window.WPP || window.WAPLUS_WPP;', "const wpp = window.__geekPickWpp?.(['whatsapp.ChatStore']);", 'direct media picker');
app = replaceAfter(app, "if (sendtoVal === 'group-members') {", 'const W = window.WPP || window.WAPLUS_WPP;', "const W = window.__geekPickWpp?.(['whatsapp.UserPrefs','group.getParticipants','contact.get','contact.getPnLidEntry']);", 'group member target picker');
app = replaceAfter(app, '// WA 裸号码不能直接当 chatId：交给 WPP queryExists 核验并转换为规范 JID', 'const W = window.WPP || window.WAPLUS_WPP;', "const W = window.__geekPickWpp?.(['contact.queryExists']);", 'number query picker');
app = replaceAfter(app, "if (bcAddVcard) bcAddVcard.addEventListener('change', async () => {", 'const W = window.WPP || window.WAPLUS_WPP;', "const W = window.__geekPickWpp?.(['chat.list']);", 'vcard contact-list picker');
app = replaceAfter(app, 'async function loadGtGroups() {', 'const W = window.WPP || window.WAPLUS_WPP;', "const W = window.__geekPickWpp?.(['chat.list']);", 'group list picker');
app = replaceAfter(app, 'gtCloneBtn.onclick = async () => {', 'const W = window.WPP || window.WAPLUS_WPP;', "const W = window.__geekPickWpp?.(['whatsapp.UserPrefs','whatsapp.GroupMetadataStore.find','group.create','group.setProperty','contact.getProfilePictureUrl','whatsapp.WidFactory']);", 'selected-group clone picker', 10000);
app = replaceAfter(app, 'if (gtCloneLinkBtn) gtCloneLinkBtn.onclick = async () => {', 'const W = window.WPP || window.WAPLUS_WPP;', "const W = window.__geekPickWpp?.(['group.getGroupInfoFromInviteCode','whatsapp.UserPrefs','whatsapp.GroupMetadataStore.find','group.create','group.setProperty','whatsapp.WidFactory']);", 'invite clone picker', 10000);
app = replaceAfter(app, 'gtDestroyBtn.onclick = async () => {', 'const W = window.WPP || window.WAPLUS_WPP, gid = ${JSON.stringify(gid)};', "const W = window.__geekPickWpp?.(['whatsapp.UserPrefs','whatsapp.GroupMetadataStore.find','group.removeParticipants','group.leave']), gid = ${JSON.stringify(gid)};", 'group destroy picker', 7000);
app = replaceAfter(app, 'gtLeaveBtn.onclick = async () => {', 'const W = window.WPP || window.WAPLUS_WPP, gid = ${JSON.stringify(gid)};', "const W = window.__geekPickWpp?.(['group.leave']), gid = ${JSON.stringify(gid)};", 'group leave picker', 7000);
app = replaceAfter(app, 'if (gtGetLinkBtn) gtGetLinkBtn.onclick = async () => {', 'const W = window.WPP || window.WAPLUS_WPP;', "const W = window.__geekPickWpp?.(['group.getInviteCode']);", 'group invite-code picker', 7000);
app = replaceAfter(app, 'if (gtEditSave) gtEditSave.onclick = async () => {', 'const W = window.WPP || window.WAPLUS_WPP;', "const W = window.__geekPickWpp?.(['chat.list','group.setProperty','group.addParticipants','group.promoteParticipants']);", 'group edit picker', 12000);
app = replaceAfter(app, 'if (bcMenuExport) bcMenuExport.onclick = async () => {', 'const W = window.WPP || window.WAPLUS_WPP;', "const W = window.__geekPickWpp?.(['chat.list']);", 'contact export picker');
if (app.includes('window.WPP || window.WAPLUS_WPP')) throw new Error('ui/app.js still contains object-existence WPP fallback selection');
write(appPath, app);

const runtimePath = 'ui/broadcast-runtime.js';
let runtime = read(runtimePath);
runtime = replaceAfter(runtime, 'async function resolveGroupMembers(ctx) {', 'const W = window.WPP || window.WAPLUS_WPP;', "const W = window.__geekPickWpp?.(['whatsapp.UserPrefs','group.getParticipants','contact.get','contact.getPnLidEntry']);", 'runtime group-member picker');
runtime = replaceAfter(runtime, 'async function resolveNumberTargets(ctx, chats, mode) {', 'const W = window.WPP || window.WAPLUS_WPP;', "const W = window.__geekPickWpp?.(['contact.queryExists']);", 'runtime number-query picker');
if (runtime.includes('window.WPP || window.WAPLUS_WPP')) throw new Error('ui/broadcast-runtime.js still contains object-existence WPP fallback selection');
write(runtimePath, runtime);

const testPath = 'test/wa-js-460-migration-contract.cjs';
let test = read(testPath);
test = replaceOnce(test, "const path = require('node:path');\n", "const path = require('node:path');\nconst vm = require('node:vm');\n", 'migration vm import');
test = replaceOnce(
  test,
  "const recovery = fs.readFileSync(path.join(root, 'ui/whatsapp-translation-hook-recovery.js'), 'utf8');\n",
  "const recovery = fs.readFileSync(path.join(root, 'ui/whatsapp-translation-hook-recovery.js'), 'utf8');\nconst { installWppCapabilityPicker, WPP_CAPABILITY_PICKER_SOURCE } = require('../src/wpp-capability-picker.cjs');\n",
  'migration picker import',
);
test = replaceOnce(
  test,
  "assert.match(main, /window\\.WPP \\|\\| window\\.WAPLUS_WPP/, 'main-process guest code must prefer stable WA-JS and preserve WAPLUS fallback');\nassert.match(app, /window\\.WPP \\|\\| window\\.WAPLUS_WPP/, 'renderer WhatsApp integrations must prefer stable WA-JS');\nassert.match(runtime, /window\\.WPP \\|\\| window\\.WAPLUS_WPP/, 'broadcast runtime must prefer stable WA-JS');\n",
  "assert.match(main, /WPP_CAPABILITY_PICKER_SOURCE/, 'main process must own the page capability picker source');\nconst pickerInstallIndex = main.indexOf('executeJavaScript(WPP_CAPABILITY_PICKER_SOURCE)', injectionOwnerIndex);\nassert.ok(pickerInstallIndex > injectionOwnerIndex && pickerInstallIndex < fallbackBundleIndex, 'capability picker must install after official injection ownership and before optional WAPLUS injection');\nfor (const [name, source] of [['main', main], ['app', app], ['runtime', runtime]]) {\n  assert.doesNotMatch(source, /window\\.WPP \\|\\| window\\.WAPLUS_WPP/, name + ' must not select WPP/WAPLUS by object existence alone');\n}\nfor (const capability of ['chat.sendTextMessage', 'chat.getMessages', 'chat.getActiveChat', 'whatsapp.ChatStore', 'contact.queryExists', 'group.getParticipants']) {\n  assert.ok(app.includes('__geekPickWpp') && app.includes(capability), 'renderer must capability-select WPP for ' + capability);\n}\nfor (const capability of ['whatsapp.UserPrefs', 'group.getParticipants', 'contact.queryExists']) {\n  assert.ok(runtime.includes('__geekPickWpp') && runtime.includes(capability), 'broadcast runtime must capability-select WPP for ' + capability);\n}\nassert.match(main, /__geekPickWpp\\?\\.\\(\\['whatsapp\\.ChatStore'\\]\\)/, 'main media path must capability-select ChatStore owner');\n",
  'migration object-existence fallback assertions',
);
test = replaceOnce(
  test,
  "assert.match(main, /waplus-wpp\\.js/, 'WAPLUS compatibility bundle must remain wired');\n\nconsole.log('WA-JS 4.6 migration contract passed');\n",
  "assert.match(main, /waplus-wpp\\.js/, 'WAPLUS compatibility bundle must remain wired');\n\nconst primary = { chat: { list() {}, sendTextMessage() {} } };\nconst fallback = { chat: { list() {}, sendTextMessage() {}, getMessages() {}, getActiveChat() {} }, whatsapp: { ChatStore: {} } };\nconst fakeWindow = { WPP: primary, WAPLUS_WPP: fallback };\nassert.equal(installWppCapabilityPicker(fakeWindow), true, 'picker installer must report success');\nassert.equal(fakeWindow.__geekPickWpp(['chat.list']), primary, 'official WPP must win when it satisfies the requested capability');\nassert.equal(fakeWindow.__geekPickWpp(['chat.getMessages']), fallback, 'WAPLUS must win when official WPP is present but lacks the requested capability');\nassert.equal(fakeWindow.__geekPickWpp(['whatsapp.ChatStore']), fallback, 'object-valued capability paths must select the capable fallback');\nassert.equal(fakeWindow.__geekPickWpp(['group.getParticipants']), null, 'picker must fail closed when neither runtime owns the capability');\nconst serializedWindow = { WPP: primary, WAPLUS_WPP: fallback };\nvm.runInNewContext(WPP_CAPABILITY_PICKER_SOURCE, { window: serializedWindow });\nassert.equal(serializedWindow.__geekPickWpp(['chat.getActiveChat']), fallback, 'serialized page picker must preserve capability-based fallback behavior');\n\nconsole.log('WA-JS 4.6 migration contract passed');\n",
  'migration synthetic picker assertions',
);
write(testPath, test);

for (const [file, mustContain] of [
  [pickerPath, 'target.__geekPickWpp'],
  [mainPath, 'executeJavaScript(WPP_CAPABILITY_PICKER_SOURCE)'],
  [appPath, "__geekPickWpp?.(['chat.sendTextMessage'])"],
  [runtimePath, "__geekPickWpp?.(['contact.queryExists'])"],
  [testPath, 'WAPLUS must win when official WPP is present but lacks the requested capability'],
]) {
  if (!read(file).includes(mustContain)) throw new Error(`${file}: final invariant missing: ${mustContain}`);
}

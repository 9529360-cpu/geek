'use strict';

const fs = require('node:fs');

function replaceOnce(source, search, replacement, label) {
  const count = source.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  return source.replace(search, replacement);
}

function replaceRegexOnce(source, pattern, replacement, label) {
  const matches = source.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)) || [];
  if (matches.length !== 1) throw new Error(`${label}: expected exactly one match, got ${matches.length}`);
  return source.replace(pattern, replacement);
}

let main = fs.readFileSync('src/main.cjs', 'utf8').replace(/\r\n?/g, '\n');
main = replaceOnce(
  main,
  "const { normalizeWebsiteUrl, parseWebsiteUrl } = require('./website-url.cjs');",
  "const { normalizeWebsiteUrl } = require('./website-url.cjs');\nconst { LINE_EXTENSION_ID, LINE_EXTENSION_URL, WA_LOCAL_PORT, WA_LOCAL_URL, WA_WEB_URL, PLATFORM_CATALOG, platformConfig } = require('./platform-catalog.cjs');\nconst { isAccountNavigationAllowed } = require('./webview-navigation-boundary.cjs');",
  'main imports'
);
main = replaceRegexOnce(
  main,
  /\/\/ LINE 官方扩展 ID[^\n]*\nconst LINE_EXTENSION_ID[\s\S]*?function appTypeConfig\(type\) \{\n  return APP_TYPES\[type\] \|\| null;\n\}\n/,
  '',
  'legacy platform metadata block'
);
main = replaceOnce(main, 'resolveTypeConfig: appTypeConfig,', 'resolveTypeConfig: platformConfig,', 'account state catalog injection');
main = main.replace(/\bappTypeConfig\(/g, 'platformConfig(');
main = main.replace(/\bAPP_TYPES\[account\.type\]/g, 'PLATFORM_CATALOG[account.type]');
main = replaceRegexOnce(
  main,
  /    const hostname = parsedSource\.hostname\.toLowerCase\(\);[\s\S]*?    if \(!isAllowed\) \{\n      event\.preventDefault\(\);\n      return;\n    \}\n/,
  "    if (!isAccountNavigationAllowed(account, partition, parsedSource.href)) {\n      event.preventDefault();\n      return;\n    }\n",
  'will-attach URL policy'
);
main = replaceRegexOnce(
  main,
  /\n    function hostAllowed\(url\) \{[\s\S]*?    webContents\.on\('will-redirect', \(event, url\) => \{\n      if \(!hostAllowed\(url\)\) event\.preventDefault\(\);\n    \}\);/,
  '',
  'legacy post-attach navigation policy'
);
if (/\bhostAllowed\b/.test(main)) throw new Error('hostAllowed survived FH-03 integration');
if (/\bAPP_TYPES\b/.test(main)) throw new Error('APP_TYPES survived FH-03 integration');
fs.writeFileSync('src/main.cjs', main);

let entry = fs.readFileSync('src/main-entry.cjs', 'utf8').replace(/\r\n?/g, '\n');
entry = entry.replace(
  /  \/\/ Legacy post-attach navigation uses a global host allowlist\.[\s\S]*?  \/\/ missing\/corrupt\/mismatched account state fails closed instead of inferring owner\n  \/\/ from the first URL observed in the guest\.\n/,
  "  // Bind the sole account-guest post-attach navigation authority before any\n  // BrowserWindow/WebView is created. Policy resolves from the authoritative account\n  // record for the fixed partition; missing/corrupt/mismatched state fails closed.\n"
);
entry = entry.replace('before the resolver implementation and legacy main.', 'before the resolver implementation and main composition.');
fs.writeFileSync('src/main-entry.cjs', entry);

let accountType = fs.readFileSync('test/account-type-boundary-contract.cjs', 'utf8').replace(/\r\n?/g, '\n');
accountType = replaceRegexOnce(
  accountType,
  /const mainSource = fs\.readFileSync[\s\S]*?assert\.match\(mainSource, \/resolveTypeConfig:\\s\*appTypeConfig\/, 'Account State owner must consume, not duplicate, APP_TYPES authority'\);/,
  "const mainSource = fs.readFileSync(path.join(root, 'src/main.cjs'), 'utf8');\nconst ownerSource = fs.readFileSync(path.join(root, 'src/account-state.cjs'), 'utf8');\nconst mainEntrySource = fs.readFileSync(path.join(root, 'src/main-entry.cjs'), 'utf8');\nconst { PLATFORM_CATALOG } = require('../src/platform-catalog.cjs');\nassert.deepEqual(Object.keys(PLATFORM_CATALOG).sort(), ['line','line-business','telegram-k','telegram-z','website','whatsapp','whatsapp-pure'].sort());\nassert.match(mainSource, /resolveTypeConfig:\\s*platformConfig/, 'Account State owner must consume the platform catalog authority');\nassert.doesNotMatch(mainSource, /const APP_TYPES\\s*=/, 'main must not duplicate platform metadata');",
  'account type authority test'
);
fs.writeFileSync('test/account-type-boundary-contract.cjs', accountType);

let telegram = fs.readFileSync('test/telegram-k-account-type-contract.cjs', 'utf8').replace(/\r\n?/g, '\n');
telegram = telegram.replace("const main = normalizeLineEndings(fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8'));", "const main = normalizeLineEndings(fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8'));\nconst catalog = normalizeLineEndings(fs.readFileSync(path.join(__dirname, '../src/platform-catalog.cjs'), 'utf8'));");
telegram = replaceRegexOnce(
  telegram,
  /const appTypes = main\.match\([\s\S]*?assert\.match\(main, \/resolveTypeConfig:\\s\*appTypeConfig\/, 'Account State owner 必须继续使用主进程 APP_TYPES 作为唯一平台类型 authority'\);/,
  "assert.match(\n  catalog,\n  /'telegram-k':\\s*freezeConfig\\(\\{[\\s\\S]*?name:\\s*'TelegramK'[\\s\\S]*?short:\\s*'TGK'[\\s\\S]*?url:\\s*'https:\\\/\\\/web\\.telegram\\.org\\\/k\\\/'[\\s\\S]*?hostnames:\\s*\\['web\\.telegram\\.org'\\][\\s\\S]*?allowSuffix:\\s*'\\.telegram\\.org'/,\n  'Telegram K 必须由 platform-catalog 注册并保持 Telegram 官方域名边界'\n);\nassert.match(main, /resolveTypeConfig:\\s*platformConfig/, 'Account State owner 必须使用 platform-catalog authority');",
  'telegram catalog authority test'
);
fs.writeFileSync('test/telegram-k-account-type-contract.cjs', telegram);

let website = fs.readFileSync('test/website-account-lifecycle-security-contract.cjs', 'utf8').replace(/\r\n?/g, '\n');
website = website.replace("const owner = readText('src/account-state.cjs');", "const owner = readText('src/account-state.cjs');\nconst catalog = readText('src/platform-catalog.cjs');");
website = replaceRegexOnce(
  website,
  /const appTypes = main\.match\([\s\S]*?assert\.match\(appTypes\[1\],[\s\S]*?'Website is a first-class platform without a fake default URL'\);/,
  "assert.match(catalog, /website:\\s*freezeConfig\\(\\{\\s*name:\\s*'自定义网站',\\s*short:\\s*'WEB',\\s*navigationKind:\\s*'website'\\s*\\}\\)/, 'Website is a first-class platform without a fake default URL');\nassert.doesNotMatch(main, /const APP_TYPES\\s*=/, 'main must consume, not duplicate, the platform catalog');",
  'website catalog authority test'
);
website = website.replace(/assert\.match\(securitySource, \/ownerIsWhatsApp\[\\s\\S\]\*did-finish-load\[\\s\\S\]\*ownerIsWhatsApp &&\/, 'WPP injection must be gated by the owning account type, not URL alone'\);/, "assert.match(securitySource, /ownerIsWhatsApp[\\s\\S]*did-finish-load[\\s\\S]*ownerIsWhatsApp &&/, 'WPP injection must be gated by the owning account type, not URL alone');");
fs.writeFileSync('test/website-account-lifecycle-security-contract.cjs', website);

let unknown = fs.readFileSync('test/webview-unknown-partition-contract.cjs', 'utf8').replace(/\r\n?/g, '\n');
unknown = unknown.replace("const end = main.indexOf(\"window.webContents.on('did-attach-webview'\", start);", "const end = main.indexOf(\"\\nlet subscriptionWindow\", start);");
fs.writeFileSync('test/webview-unknown-partition-contract.cjs', unknown);

console.log('FH03_INTEGRATION_OK');

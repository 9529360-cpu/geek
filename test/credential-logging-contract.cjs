'use strict';
// 契约：main.cjs LINE 日志不得输出凭据头原值（X-Line-Session-ID / X-LST / Cookie / Authorization）
// 且 URL 日志必须去掉 query（可能携带会话/令牌参数）。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');

// 1. LINE 请求头日志必须只记录敏感头存在性，不得输出原值
const hdrLine = main.split('\n').find((l) => l.includes('[line-hdr]'));
assert.ok(hdrLine, '必须存在 [line-hdr] 日志');
assert.match(hdrLine, /XSID=\$\{h\['X-Line-Session-ID'\].*\?'yes':'no'\}/, 'X-Line-Session-ID 必须只输出存在性布尔值');
assert.match(hdrLine, /XLST=\$\{h\['X-LST'\].*\?'yes':'no'\}/, 'X-LST 必须只输出存在性布尔值');
assert.doesNotMatch(hdrLine, /XSID=\$\{h\['X-Line-Session-ID'\]\|\|''\}/, '不得输出 X-Line-Session-ID 原值');
assert.doesNotMatch(hdrLine, /XLST=\$\{h\['X-LST'\]\|\|''\}/, '不得输出 X-LST 原值');

// 2. LINE 日志不得打印 Cookie / Authorization / Origin / Referer 原值
const logRegion = main.slice(main.indexOf('onBeforeSendHeaders'), main.indexOf('loadExtension'));
assert.doesNotMatch(logRegion, /Cookie=\$\{/, 'LINE 日志不得输出 Cookie 头');
assert.doesNotMatch(logRegion, /Authorization=\$\{/, 'LINE 日志不得输出 Authorization 头');
assert.doesNotMatch(hdrLine, /Origin=\$\{/, 'LINE 日志不得输出 Origin 原值');
assert.doesNotMatch(hdrLine, /Referer=\$\{/, 'LINE 日志不得输出 Referer 原值');
assert.match(hdrLine, /OriginPresent=\$\{h\['Origin'\].*\?'yes':'no'\}/, 'Origin 只能记录存在性');
assert.match(hdrLine, /RefererPresent=\$\{h\['Referer'\].*\?'yes':'no'\}/, 'Referer 只能记录存在性');

// 3. LINE 请求/完成日志必须对 URL 去 query（host+pathname）
assert.match(main, /new URL\(details\.url\)/, '必须用 URL 解析去 query');
assert.match(main, /urlSafe = `\$\{u\.host\}\$\{u\.pathname\}`/, '请求日志 URL 只保留 host+pathname');
assert.match(main, /const u = new URL\(details\.url\)/, '完成日志同样必须 URL 去 query');

// 4. 全文件不得再出现任何直接把请求头原值写入 console 的表达式
assert.doesNotMatch(main, /console\.(log|error|warn)\([^\n]*X-Line-Session-ID'\]\s*\|\|/, '不得直接输出 X-Line-Session-ID 原值到日志');
assert.doesNotMatch(main, /console\.(log|error|warn)\([^\n]*X-LST'\]\s*\|\|/, '不得直接输出 X-LST 原值到日志');
assert.doesNotMatch(main, /console\.(log|error|warn)\([^\n]*Referer'\]\s*\|\|/, '不得直接输出 Referer 原值到日志');

console.log('CREDENTIAL_LOGGING_CONTRACT_OK');

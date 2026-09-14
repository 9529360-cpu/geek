'use strict';

const fs = require('node:fs');

const file = 'test/wpp-converge-contract.cjs';
let source = fs.readFileSync(file, 'utf8');
const before = "assert.match(main, /window\\.WPP \\|\\| window\\.WAPLUS_WPP/, '页面 API 必须以 WA-JS 为主并保留 WAPLUS_WPP 回退');";
const after = [
  "assert.match(main, /WPP_CAPABILITY_PICKER_SOURCE/, '页面 API 必须安装 WA-JS/WAPLUS capability picker');",
  "assert.match(main, /__geekPickWpp\\?\\.\\(\\['whatsapp\\.ChatStore'\\]\\)/, '媒体发送必须按 ChatStore 能力选择 WA-JS/WAPLUS owner');",
  "assert.doesNotMatch(main, /window\\.WPP \\|\\| window\\.WAPLUS_WPP/, '主进程不得仅按对象存在性选择 WA-JS/WAPLUS');",
].join('\n');
const count = source.split(before).length - 1;
if (count !== 1) throw new Error(`wpp converge fallback oracle anchor count=${count}`);
source = source.replace(before, after);
fs.writeFileSync(file, source);
if (!source.includes('媒体发送必须按 ChatStore 能力选择 WA-JS/WAPLUS owner')) {
  throw new Error('updated WPP converge capability oracle missing');
}

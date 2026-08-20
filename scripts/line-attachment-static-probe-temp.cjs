'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'resources', 'extensions', 'line-3.5.1');
const mainPath = path.join(root, 'static', 'js', 'main.js');
const cssPath = path.join(root, 'static', 'css', 'main.bd68b7d9.css');
const main = fs.readFileSync(mainPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');

const probes = [
  'send_file_message',
  'clipboardData.files',
  'sendFilelist-module__send_file_list__CIZiJ',
  'sendFilelistItem-module__send_file_item__fZKNt',
  'data-file-support',
  'chat.desc.quit.uploading',
];

function positions(text, needle) {
  const out = [];
  let from = 0;
  while (true) {
    const at = text.indexOf(needle, from);
    if (at < 0) return out;
    out.push(at);
    from = at + Math.max(1, needle.length);
  }
}

function emitContext(text, at, needle, before = 6500, after = 8500) {
  const start = Math.max(0, at - before);
  const end = Math.min(text.length, at + needle.length + after);
  const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
  console.log(`CTX_START=${start} CTX_END=${end}`);
  console.log(snippet);
  console.log('CTX_DONE');
}

console.log('LINE_ATTACHMENT_FOCUSED_PROBE');
console.log(`main_bytes=${Buffer.byteLength(main)}`);
console.log(`css_bytes=${Buffer.byteLength(css)}`);

for (const needle of probes) {
  const found = positions(main, needle);
  console.log(`PROBE ${JSON.stringify(needle)} count=${found.length}`);
  for (const [index, at] of found.slice(0, 4).entries()) {
    console.log(`MATCH ${index + 1} offset=${at}`);
    emitContext(main, at, needle);
  }
}

const sendFileClasses = Array.from(new Set(css.match(/[A-Za-z0-9_-]*send[A-Za-z0-9_-]*file[A-Za-z0-9_-]*/gi) || [])).sort();
console.log(`SEND_FILE_CSS_IDENTIFIERS count=${sendFileClasses.length}`);
for (const name of sendFileClasses) console.log(name);

const cssNeedles = ['sendFilelist-module__send_file_list__CIZiJ', 'sendFilelistItem-module__send_file_item__fZKNt'];
for (const needle of cssNeedles) {
  const at = css.indexOf(needle);
  console.log(`CSS_PROBE ${JSON.stringify(needle)} offset=${at}`);
  if (at >= 0) emitContext(css, at, needle, 1200, 4200);
}

for (const required of ['send_file_message', 'clipboardData.files', 'sendFilelist-module__send_file_list__CIZiJ']) {
  if (!main.includes(required)) throw new Error(`missing required LINE attachment evidence: ${required}`);
}

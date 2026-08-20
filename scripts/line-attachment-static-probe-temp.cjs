'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'resources', 'extensions', 'line-3.5.1');
const main = fs.readFileSync(path.join(root, 'static', 'js', 'main.js'), 'utf8');

const probes = [
  'clipboardData.files',
  'onDrop: bS',
  'bS =',
  'const bS',
  'function bS',
  'lI({ multiple: !0 }',
  'sendFileModal-module__button_send__IQKjX',
  '(0, Nn.jsx)(_W',
  '(0, Nn.jsxs)(_W',
  '_W, {',
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

function emit(text, at, needle, before = 9000, after = 12000) {
  const start = Math.max(0, at - before);
  const end = Math.min(text.length, at + needle.length + after);
  console.log(`CTX_START=${start} CTX_END=${end}`);
  console.log(text.slice(start, end).replace(/\s+/g, ' ').trim());
  console.log('CTX_DONE');
}

console.log('LINE_ATTACHMENT_CALLBACK_PROBE');
console.log(`main_bytes=${Buffer.byteLength(main)}`);
for (const needle of probes) {
  const found = positions(main, needle);
  console.log(`PROBE ${JSON.stringify(needle)} count=${found.length}`);
  for (const [index, at] of found.slice(0, 5).entries()) {
    console.log(`MATCH ${index + 1} offset=${at}`);
    emit(main, at, needle);
  }
}

const required = ['clipboardData.files', 'onDrop: bS', 'sendFileModal-module__button_send__IQKjX'];
for (const needle of required) {
  if (!main.includes(needle)) throw new Error(`missing required LINE attachment callback evidence: ${needle}`);
}

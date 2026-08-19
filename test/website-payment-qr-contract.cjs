'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const workerPath = path.join(root, 'scripts', 'geek-website-worker.js');
const qrPath = path.join(root, 'scripts', 'website-payment-qr.mjs');
const workerSource = fs.readFileSync(workerPath, 'utf8');
const releaseWorker = fs.readFileSync(path.join(root, 'scripts', 'geek-release-worker.js'), 'utf8');

(async () => {
  const qr = await import(`${pathToFileURL(qrPath).href}?contract=${Date.now()}`);
  const address = 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE';

  assert.equal(qr.isTronAddress(address), true, '标准 TRON Base58 地址必须通过校验');
  assert.equal(qr.isTronAddress('T000000000000000000000000000000000'), false, '含非 Base58 字符的地址必须拒绝');
  assert.equal(qr.isTronAddress('not-a-tron-address'), false, '非 TRON 地址必须拒绝');

  const matrix = qr.encodeQrMatrix(address);
  assert.equal(qr.QR_VERSION, 3, '支付二维码固定使用 QR Version 3');
  assert.equal(qr.QR_SIZE, 29, 'Version 3 矩阵必须为 29x29');
  assert.equal(matrix.length, 29);
  assert.ok(matrix.every((row) => row.length === 29), '二维码矩阵必须保持方形');

  // Reference: QR Version 3, error correction M, byte mode, mask 0.
  const rows = matrix.map((row) => row.map((cell) => cell ? '1' : '0').join('')).join('\n');
  assert.equal(
    crypto.createHash('sha256').update(rows).digest('hex'),
    '9c3ddcf8deaee588c70236e2b2667d5a50b0581a01d613400505b9fb6f6e20e6',
    '支付地址矩阵必须继续匹配标准 QR 参考结果'
  );

  const svg = qr.renderTronAddressQrSvg(address);
  assert.match(svg, /^<svg[^>]+viewBox="0 0 37 37"/);
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.match(svg, /<path d="M/);
  assert.doesNotMatch(svg, /<script|onload=|javascript:/i, '二维码 SVG 不得包含可执行内容');
  assert.throws(() => qr.renderTronAddressQrSvg('bad'), /Invalid TRON address/);

  assert.doesNotMatch(
    workerSource,
    /geek-release\.9529360\.workers\.dev\/usdt-qr\.png|RELEASE_BASE[^\n]*usdt-qr\.png/,
    '官网不得再从 updater Worker 请求支付二维码'
  );
  assert.match(workerSource, /encodeURIComponent\(pay\.usdt_address\)/, '二维码 URL 必须来自当前订单地址');
  assert.match(workerSource, /path === '\/payment-qr'/, '官网必须提供同源支付二维码路由');
  assert.match(workerSource, /id="usdt-qr-fallback"/, '二维码加载失败时必须保留复制地址提示');
  assert.doesNotMatch(releaseWorker, /usdt-qr\.png/, 'release Worker 不得扩展为支付静态资源服务');

  const executable = workerSource
    .replace(/^import \{ isTronAddress, renderTronAddressQrSvg \} from '\.\/website-payment-qr\.mjs';\r?\n/m, '')
    .replace(/^export default\s*/m, 'this.__worker = ');
  const sandbox = {
    Response,
    Request,
    Headers,
    URL,
    TextEncoder,
    TextDecoder,
    crypto: globalThis.crypto,
    console,
    fetch: async () => { throw new Error('unexpected upstream request'); },
    isTronAddress: qr.isTronAddress,
    renderTronAddressQrSvg: qr.renderTronAddressQrSvg,
  };
  vm.createContext(sandbox);
  vm.runInContext(executable, sandbox, { filename: workerPath });

  const response = await sandbox.__worker.fetch(new Request(
    `https://geek.bbnba.com/payment-qr?address=${encodeURIComponent(address)}`
  ));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /^image\/svg\+xml/i);
  assert.equal(response.headers.get('cache-control'), 'private, max-age=300');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.match(await response.text(), /^<svg/);

  const invalid = await sandbox.__worker.fetch(new Request(
    'https://geek.bbnba.com/payment-qr?address=not-a-valid-address'
  ));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(await invalid.text(), /not-a-valid-address/, '错误响应不得回显无效输入');

  console.log('WEBSITE_PAYMENT_QR_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

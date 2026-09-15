'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const billingSource = read('scripts/geek-subscription-worker-core.js');
const themeSource = read('scripts/geek-marketing-theme.mjs');
const visualsSource = read('scripts/geek-marketing-visuals.mjs');
const pagesSource = read('scripts/geek-marketing-pages.mjs');

function billingPlansFromSource(source) {
  const block = source.match(/const PLANS = \{([\s\S]*?)\n\};/)?.[1] || '';
  const plans = [];
  const row = /\b(basic|standard|pro):\s*\{\s*name:\s*'([^']+)',\s*priceUsd:\s*(\d+),\s*chars:\s*(\d+)\s*\}/g;
  for (const match of block.matchAll(row)) {
    plans.push({ id: match[1], name: match[2], priceUsd: Number(match[3]), chars: Number(match[4]) });
  }
  return plans;
}

(async () => {
  const pricing = await import(pathToFileURL(path.join(root, 'scripts/geek-public-pricing.mjs')).href);
  const pages = await import(pathToFileURL(path.join(root, 'scripts/geek-marketing-pages.mjs')).href);
  const billingPlans = billingPlansFromSource(billingSource);
  const freeQuota = Number(billingSource.match(/const FREE_QUOTA_CHARS = (\d+);/)?.[1] || 0);

  assert.equal(billingPlans.length, 3, 'billing authority must expose the expected three character-pack rows');
  assert.deepEqual(
    pricing.PUBLIC_PRICING.map(plan => ({ ...plan })),
    billingPlans,
    'public pricing projection must match the subscription Worker billing authority exactly',
  );
  assert.equal(pricing.FREE_QUOTA_CHARS, freeQuota, 'public free quota must match registration billing authority');
  assert.equal(pricing.formatCharacterAmount(20000), '2 万');
  assert.equal(pricing.formatCharacterAmount(1000000), '100 万');

  assert.match(themeSource, /MARKETING_ROUTES[^\n]*'\/pricing'/, 'pricing must be a canonical marketing route');
  assert.match(themeSource, /'\/pricing': \{/, 'pricing must have dedicated metadata');
  assert.match(visualsSource, /\['\/pricing', '价格'\]/, 'primary marketing navigation must expose pricing');
  assert.match(visualsSource, /href="\/pricing">价格<\/a>/, 'marketing footer must expose pricing');
  assert.match(pagesSource, /PUBLIC_PRICING/, 'pricing page must render from the public billing projection');
  assert.match(pagesSource, /FREE_QUOTA_CHARS/, 'pricing page must render the authoritative free quota projection');

  const html = pages.PAGE_BODY['/pricing']();
  assert.match(html, /按实际翻译用量付费/);
  assert.match(html, /注册赠送 2 万字符/);
  assert.match(html, /基础包 · \$25/);
  assert.match(html, /标准包 · \$48/);
  assert.match(html, /大包 · \$128/);
  assert.match(html, /100 万翻译字符/);
  assert.match(html, /150 万翻译字符/);
  assert.match(html, /450 万翻译字符/);
  assert.match(html, /不是功能等级|不是功能权限分层/);
  assert.doesNotMatch(html, /最受欢迎|主流之选/, 'public pricing must not recommend a non-monotonic package without a real entitlement/value basis');
  assert.doesNotMatch(html, /usdt_address|T[1-9A-HJ-NP-Za-km-z]{33}/, 'marketing pricing must never embed payment destinations');

  console.log('PUBLIC_PRICING_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

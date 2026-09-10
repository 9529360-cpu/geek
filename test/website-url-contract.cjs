'use strict';

// Final CI trigger; removed in the immediately following commit so the feature diff stays focused.
const assert = require('node:assert/strict');
const {
  ACCOUNT_WEBSITE_URL_INVALID,
  parseWebsiteUrl,
  normalizeWebsiteUrl,
} = require('../src/website-url.cjs');

for (const value of [
  'https://example.com',
  'https://example.com/app',
  'https://chat.example.com/path?q=1#section',
  '  https://EXAMPLE.com/app  ',
]) {
  const parsed = parseWebsiteUrl(value);
  assert.equal(parsed.protocol, 'https:');
  assert.ok(parsed.hostname);
}

assert.equal(normalizeWebsiteUrl('https://example.com'), 'https://example.com/');
assert.equal(normalizeWebsiteUrl('  https://EXAMPLE.com/app  '), 'https://example.com/app');

for (const value of [
  '',
  '   ',
  undefined,
  null,
  'example.com',
  'not a url',
  'http://example.com',
  'file:///tmp/example.html',
  'data:text/html,hello',
  'javascript:alert(1)',
  'chrome-extension://ophjlpahpchlmihnnnihgmmeilfjmjjc/index.html',
  'https://',
  'https://user@example.com/',
  'https://user:pass@example.com/',
]) {
  assert.throws(
    () => normalizeWebsiteUrl(value),
    (error) => error?.code === ACCOUNT_WEBSITE_URL_INVALID
      && error?.message === ACCOUNT_WEBSITE_URL_INVALID,
    `invalid Website URL must fail closed: ${String(value)}`,
  );
}

console.log('WEBSITE_URL_CONTRACT_OK');

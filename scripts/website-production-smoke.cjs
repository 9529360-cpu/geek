'use strict';

const fs = require('node:fs');

const SITE_ORIGIN = 'https://geek.bbnba.com';
const RELEASE_ORIGIN = 'https://geek-release.9529360.workers.dev';
const DEFAULT_ATTEMPTS = 4;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_RETRY_DELAY_MS = 2_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, {
  fetchImpl = globalThis.fetch,
  attempts = DEFAULT_ATTEMPTS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  redirect = 'follow',
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('website smoke request timed out')), timeoutMs);
    try {
      return await fetchImpl(url, {
        method: 'GET',
        redirect,
        signal: controller.signal,
        headers: { 'User-Agent': 'geek-production-smoke/1' },
      });
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
    } finally {
      clearTimeout(timer);
    }
    if (retryDelayMs > 0) await sleep(retryDelayMs);
  }

  throw new Error(`public website request failed after ${attempts} attempts: ${url}`, { cause: lastError });
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(`${label} returned HTTP ${response.status}; expected ${expected}`);
  }
}

function assertHeaderContains(response, name, expected, label) {
  const value = response.headers.get(name) || '';
  if (!value.toLowerCase().includes(String(expected).toLowerCase())) {
    throw new Error(`${label} missing required ${name} marker`);
  }
}

async function verifyHtml(pathname, markers, options) {
  const label = `website ${pathname}`;
  const response = await fetchWithRetry(`${SITE_ORIGIN}${pathname}`, options);
  assertStatus(response, 200, label);
  assertHeaderContains(response, 'content-type', 'text/html', label);
  assertHeaderContains(response, 'content-security-policy', "script-src 'none'", label);
  const body = await response.text();
  if (/<script\b/i.test(body)) throw new Error(`${label} unexpectedly contains a script element`);
  for (const marker of markers) {
    if (!body.includes(marker)) throw new Error(`${label} missing required product marker`);
  }
  return response.status;
}

async function verifySitemap(options) {
  const response = await fetchWithRetry(`${SITE_ORIGIN}/sitemap.xml`, options);
  assertStatus(response, 200, 'website sitemap');
  assertHeaderContains(response, 'content-type', 'application/xml', 'website sitemap');
  const body = await response.text();
  for (const path of ['/guide', '/faq']) {
    if (!body.includes(`<loc>${SITE_ORIGIN}${path}</loc>`)) {
      throw new Error(`website sitemap missing required route ${path}`);
    }
  }
  return response.status;
}

async function verifyDownload(options) {
  const response = await fetchWithRetry(`${SITE_ORIGIN}/download`, { ...options, redirect: 'manual' });
  if (response.status < 300 || response.status >= 400) {
    throw new Error(`website /download returned HTTP ${response.status}; expected redirect`);
  }
  const location = response.headers.get('location') || '';
  const pattern = new RegExp(`^${RELEASE_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/geek-setup-[0-9]+\\.[0-9]+\\.[0-9]+\\.exe$`);
  if (!pattern.test(location)) {
    throw new Error('website /download no longer delegates to the approved Geek release Worker installer path');
  }
  return response.status;
}

async function runSmoke({
  fetchImpl = globalThis.fetch,
  attempts = DEFAULT_ATTEMPTS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
} = {}) {
  const options = { fetchImpl, attempts, timeoutMs, retryDelayMs };

  const health = await fetchWithRetry(`${SITE_ORIGIN}/health`, options);
  if (health.status < 200 || health.status >= 400) {
    throw new Error(`website /health returned HTTP ${health.status}`);
  }
  if (health.body && typeof health.body.cancel === 'function') await health.body.cancel();

  await verifyHtml('/', ['一个桌面，', '先跑通一个账号'], options);
  await verifyHtml('/guide', ['先跑通一个账号', '先验证日常收发'], options);
  await verifyHtml('/faq', ['先把边界说清楚', '独立产品'], options);
  await verifySitemap(options);
  await verifyDownload(options);

  const result = { healthHttpCode: String(health.status), routesChecked: 6 };
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    fs.appendFileSync(outputPath, `health_http_code=${result.healthHttpCode}\nroutes_checked=${result.routesChecked}\n`, 'utf8');
  }
  return result;
}

module.exports = {
  SITE_ORIGIN,
  RELEASE_ORIGIN,
  fetchWithRetry,
  verifyHtml,
  verifySitemap,
  verifyDownload,
  runSmoke,
};

if (require.main === module) {
  runSmoke()
    .then(({ healthHttpCode, routesChecked }) => {
      console.log(`WEBSITE_PRODUCTION_SMOKE_OK health_http=${healthHttpCode} routes=${routesChecked}`);
    })
    .catch((error) => {
      console.error(`WEBSITE_PRODUCTION_SMOKE_FAILED: ${error && error.message ? error.message : error}`);
      process.exitCode = 1;
    });
}

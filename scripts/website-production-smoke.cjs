'use strict';

const fs = require('node:fs');

const SITE_ORIGIN = 'https://geek.bbnba.com';
const RELEASE_ORIGIN = 'https://geek-release.9529360.workers.dev';
const WORKER_NAME = 'geek-website';
const WORKER_VERSION_HEADER = 'X-Geek-Worker-Version';
const VERSION_OVERRIDE_HEADER = 'Cloudflare-Workers-Version-Overrides';
const DEPLOY_PROBE_PARAM = '__geek_deploy';
const DEFAULT_ATTEMPTS = 6;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_RETRY_DELAY_MS = 2_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCacheBust(value) {
  const normalized = String(value || '').trim().replace(/[^a-z0-9._-]/gi, '-').slice(0, 128);
  return normalized || `${Date.now()}-${process.pid}`;
}

function normalizeWorkerVersion(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)) {
    throw new Error('GEEK_EXPECTED_WORKER_VERSION must be a Cloudflare Worker version UUID');
  }
  return normalized;
}

function deploymentProbeUrl(pathname, cacheBust) {
  const url = new URL(pathname, SITE_ORIGIN);
  url.searchParams.set(DEPLOY_PROBE_PARAM, normalizeCacheBust(cacheBust));
  return url.toString();
}

function observedWorkerVersion(response) {
  return String(response?.headers?.get?.(WORKER_VERSION_HEADER) || '').trim().toLowerCase();
}

async function discardResponse(response) {
  try {
    if (response?.body && typeof response.body.cancel === 'function') await response.body.cancel();
  } catch (_) {}
}

async function fetchWithRetry(url, {
  fetchImpl = globalThis.fetch,
  attempts = DEFAULT_ATTEMPTS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  redirect = 'follow',
  expectedWorkerVersion,
  acceptResponse = () => true,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  const expectedVersion = normalizeWorkerVersion(expectedWorkerVersion);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('website smoke request timed out')), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        redirect,
        signal: controller.signal,
        headers: {
          'User-Agent': 'geek-production-smoke/2',
          [VERSION_OVERRIDE_HEADER]: `${WORKER_NAME}="${expectedVersion}"`,
        },
      });
      const observedVersion = observedWorkerVersion(response);
      const accepted = observedVersion === expectedVersion && Boolean(await acceptResponse(response));
      if (accepted) return response;

      lastError = new Error(
        `deployment not converged: HTTP ${response.status}; worker version ${observedVersion || 'unavailable'}; expected ${expectedVersion}`,
      );
      await discardResponse(response);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < attempts && retryDelayMs > 0) await sleep(retryDelayMs);
  }

  throw new Error(
    `public website request failed after ${attempts} attempts: ${url}${lastError?.message ? ` (${lastError.message})` : ''}`,
    { cause: lastError },
  );
}

function assertHeaderContains(response, name, expected, label) {
  const value = response.headers.get(name) || '';
  if (!value.toLowerCase().includes(String(expected).toLowerCase())) {
    throw new Error(`${label} missing required ${name} marker`);
  }
}

async function verifyHtml(pathname, markers, options) {
  const label = `website ${pathname}`;
  const response = await fetchWithRetry(deploymentProbeUrl(pathname, options?.cacheBust), {
    ...options,
    acceptResponse: response => response.status === 200,
  });
  assertHeaderContains(response, 'content-type', 'text/html', label);
  assertHeaderContains(response, 'content-security-policy', "script-src 'none'", label);
  assertHeaderContains(response, 'cross-origin-opener-policy', 'same-origin', label);
  const body = await response.text();
  if (/<script\b/i.test(body)) throw new Error(`${label} unexpectedly contains a script element`);
  for (const marker of markers) {
    if (!body.includes(marker)) throw new Error(`${label} missing required product marker`);
  }
  return response.status;
}

async function verifySitemap(options) {
  const response = await fetchWithRetry(deploymentProbeUrl('/sitemap.xml', options?.cacheBust), {
    ...options,
    acceptResponse: response => response.status === 200,
  });
  assertHeaderContains(response, 'content-type', 'application/xml', 'website sitemap');
  const body = await response.text();
  for (const path of ['/pricing', '/guide', '/faq']) {
    if (!body.includes(`<loc>${SITE_ORIGIN}${path}</loc>`)) {
      throw new Error(`website sitemap missing required route ${path}`);
    }
  }
  return response.status;
}

async function verifyDownload(options) {
  const response = await fetchWithRetry(deploymentProbeUrl('/download', options?.cacheBust), {
    ...options,
    redirect: 'manual',
    acceptResponse: response => response.status >= 300 && response.status < 400,
  });
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
  cacheBust = process.env.GITHUB_SHA,
  expectedWorkerVersion = process.env.GEEK_EXPECTED_WORKER_VERSION,
} = {}) {
  const normalizedVersion = normalizeWorkerVersion(expectedWorkerVersion);
  const options = {
    fetchImpl,
    attempts,
    timeoutMs,
    retryDelayMs,
    cacheBust: normalizeCacheBust(cacheBust),
    expectedWorkerVersion: normalizedVersion,
  };

  const health = await fetchWithRetry(deploymentProbeUrl('/health', options.cacheBust), {
    ...options,
    acceptResponse: response => response.status >= 200 && response.status < 400,
  });
  const healthHttpCode = String(health.status);
  if (health.body && typeof health.body.cancel === 'function') await health.body.cancel();

  await verifyHtml('/', ['一个桌面，', '先跑通一个账号'], options);
  await verifyHtml('/pricing', ['按实际翻译用量付费', '注册赠送 2 万字符'], options);
  await verifyHtml('/guide', ['先跑通一个账号', '先验证日常收发'], options);
  await verifyHtml('/faq', ['先把边界说清楚', '独立产品'], options);
  await verifySitemap(options);
  await verifyDownload(options);

  const result = { healthHttpCode, routesChecked: 7, workerVersion: normalizedVersion };
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    fs.appendFileSync(
      outputPath,
      `health_http_code=${result.healthHttpCode}\nroutes_checked=${result.routesChecked}\nworker_version=${result.workerVersion}\n`,
      'utf8',
    );
  }
  return result;
}

module.exports = {
  SITE_ORIGIN,
  RELEASE_ORIGIN,
  WORKER_NAME,
  WORKER_VERSION_HEADER,
  VERSION_OVERRIDE_HEADER,
  DEPLOY_PROBE_PARAM,
  normalizeWorkerVersion,
  deploymentProbeUrl,
  observedWorkerVersion,
  fetchWithRetry,
  verifyHtml,
  verifySitemap,
  verifyDownload,
  runSmoke,
};

if (require.main === module) {
  runSmoke()
    .then(({ healthHttpCode, routesChecked, workerVersion }) => {
      console.log(`WEBSITE_PRODUCTION_SMOKE_OK health_http=${healthHttpCode} routes=${routesChecked} worker_version=${workerVersion}`);
    })
    .catch((error) => {
      console.error(`WEBSITE_PRODUCTION_SMOKE_FAILED: ${error && error.message ? error.message : error}`);
      process.exitCode = 1;
    });
}

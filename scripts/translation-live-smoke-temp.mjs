import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const subscriptionBase = 'https://geek-subscription.9529360.workers.dev';
const translateBase = 'https://geek-translate.9529360.workers.dev';
const infraToken = process.env.CLOUDFLARE_INFRA_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!infraToken) throw new Error('Missing CLOUDFLARE_INFRA_API_TOKEN');
if (!accountId) throw new Error('Missing CLOUDFLARE_ACCOUNT_ID');

const wrangler = await readFile(new URL('../wrangler-subscription.toml', import.meta.url), 'utf8');
const databaseId = wrangler.match(/database_id\s*=\s*"([0-9a-f-]{36})"/i)?.[1];
if (!databaseId) throw new Error('Unable to resolve D1 database_id');

const suffix = `${Date.now()}-${randomBytes(5).toString('hex')}`;
const email = `translate-smoke-${suffix}@example.invalid`;
const password = `Gk!${randomBytes(24).toString('base64url')}`;
const requestId = randomUUID();
let userId = null;

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function d1Query(sql, params = []) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${infraToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const payload = await response.json().catch(() => ({}));
  const ok = response.ok && payload?.success !== false && Array.isArray(payload?.result) && payload.result.every((item) => item?.success !== false);
  if (!ok) throw new Error(`D1 query failed (HTTP ${response.status})`);
  return payload.result[0]?.results || [];
}

function requireOk(label, result) {
  if (!result.response.ok || result.payload?.ok === false) {
    throw new Error(`${label} failed (HTTP ${result.response.status}, code ${String(result.payload?.error || 'unknown_error')})`);
  }
  console.log(`OK ${label} HTTP ${result.response.status}`);
}

async function cleanup() {
  try {
    const rows = await d1Query('SELECT id FROM users WHERE email = ?;', [email]);
    const id = Number(rows[0]?.id || userId || 0);
    if (id > 0) {
      await d1Query('DELETE FROM translation_usage WHERE user_id = ?;', [id]);
      await d1Query('DELETE FROM users WHERE id = ?;', [id]);
    }
    console.log('OK transient smoke cleanup');
  } catch (error) {
    console.warn(`cleanup failed: ${error.message}`);
  }
}

try {
  const health = await jsonRequest(`${translateBase}/health`);
  console.log(`HEALTH HTTP ${health.response.status} ok=${String(health.payload?.ok)} providers=${Array.isArray(health.payload?.providers) ? health.payload.providers.join(',') : 'unknown'}`);
  if (!health.response.ok || health.payload?.ok !== true) throw new Error('translation health failed');

  const register = await jsonRequest(`${subscriptionBase}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  requireOk('register', register);
  userId = Number(register.payload?.userId);
  if (!Number.isSafeInteger(userId) || userId < 1) throw new Error('invalid userId');

  const login = await jsonRequest(`${subscriptionBase}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  requireOk('login', login);
  const loginToken = String(login.payload?.token || '');
  if (loginToken.length < 40) throw new Error('invalid login token');

  const short = await jsonRequest(`${subscriptionBase}/api/translation-token`, {
    method: 'POST', headers: { Authorization: `Bearer ${loginToken}`, 'Content-Type': 'application/json' },
  });
  requireOk('translation-token', short);
  const shortToken = String(short.payload?.token || '');
  if (shortToken.length < 40) throw new Error('invalid translation token');

  const translated = await jsonRequest(`${translateBase}/v1/translate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${shortToken}`, 'Content-Type': 'application/json', 'X-Request-ID': requestId },
    body: JSON.stringify({ text: 'Hello, this is a Geek translation channel live smoke test.', source: 'en', target: 'zh', provider: 'auto', route: 'default' }),
  });
  if (!translated.response.ok || typeof translated.payload?.text !== 'string' || !translated.payload.text.trim()) {
    throw new Error(`translate failed (HTTP ${translated.response.status}, code ${String(translated.payload?.error || 'unknown_error')})`);
  }
  console.log(`OK translate HTTP ${translated.response.status} engine=${String(translated.payload?.engine || 'unknown')}`);

  const rows = await d1Query('SELECT status, reserved_chars, target_chars, created_at, completed_at FROM translation_usage WHERE request_id = ?;', [requestId]);
  const usage = rows[0];
  if (!usage) throw new Error('translation request missing from D1');
  if (usage.status !== 'complete' || !usage.completed_at) throw new Error(`translation request status=${String(usage.status)}`);
  console.log(`OK D1 receipt status=${usage.status} reserved=${Number(usage.reserved_chars)} target=${Number(usage.target_chars)} created=${usage.created_at} completed=${usage.completed_at}`);
  console.log('TRANSLATION_LIVE_SMOKE_OK');
} finally {
  await cleanup();
}

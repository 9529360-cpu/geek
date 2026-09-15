import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const subscriptionBase = 'https://geek-subscription.9529360.workers.dev';
const translationBase = 'https://geek-translate.9529360.workers.dev';
const infraToken = String(process.env.CLOUDFLARE_INFRA_API_TOKEN || '').trim();
const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();

if (!infraToken) throw new Error('Missing CLOUDFLARE_INFRA_API_TOKEN');
if (!accountId) throw new Error('Missing CLOUDFLARE_ACCOUNT_ID');

const wrangler = await readFile(new URL('../wrangler-subscription.toml', import.meta.url), 'utf8');
const databaseId = wrangler.match(/database_id\s*=\s*"([0-9a-f-]{36})"/i)?.[1];
if (!databaseId) throw new Error('Unable to resolve subscription D1 database_id');

const suffix = `${Date.now()}-${randomBytes(5).toString('hex')}`;
const email = `translation-smoke-${suffix}@example.invalid`;
const password = `Gk!${randomBytes(24).toString('base64url')}`;
let registered = false;

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function requireOk(label, result) {
  if (!result.response.ok || result.payload?.ok === false) {
    const code = typeof result.payload?.error === 'string' ? result.payload.error : 'unknown_error';
    throw new Error(`${label} failed (HTTP ${result.response.status}, code ${code})`);
  }
}

async function cleanup() {
  if (!registered) return;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${infraToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: 'DELETE FROM users WHERE email = ?;', params: [email] }),
    }
  );
  const payload = await response.json().catch(() => ({}));
  const ok = response.ok && payload?.success !== false && Array.isArray(payload?.result) && payload.result.every((item) => item?.success !== false);
  if (!ok) throw new Error(`cleanup failed (HTTP ${response.status})`);
  console.log('OK transient translation smoke account cleanup');
}

let primaryError = null;
try {
  const register = await jsonRequest(`${subscriptionBase}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  requireOk('register', register);
  registered = true;

  const login = await jsonRequest(`${subscriptionBase}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  requireOk('login', login);
  const sessionToken = String(login.payload?.token || '');
  if (sessionToken.length < 40) throw new Error('login returned invalid token');

  const status = await jsonRequest(`${subscriptionBase}/api/status`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  requireOk('status', status);
  if (!(Number(status.payload?.remaining_chars) > 100)) throw new Error('transient account has insufficient translation quota');

  const translationTokenResult = await jsonRequest(`${subscriptionBase}/api/translation-token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
  });
  requireOk('translation-token', translationTokenResult);
  const translationToken = String(translationTokenResult.payload?.token || '');
  if (translationToken.length < 40) throw new Error('translation-token returned invalid token');

  const requestId = randomUUID();
  const sourceText = 'Hello, this is a live translation smoke test.';
  const translated = await jsonRequest(`${translationBase}/v1/translate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${translationToken}`,
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
      'X-Geek-Deadline-Ms': '30000',
    },
    body: JSON.stringify({
      text: sourceText,
      source: 'en',
      target: 'it',
      provider: 'auto',
      route: 'default',
    }),
  });
  requireOk('translate', translated);

  const output = String(translated.payload?.text || '').trim();
  const engine = String(translated.payload?.engine || '').trim();
  if (!output) throw new Error('translate returned empty text');
  if (!['gemini', 'mistral', 'glm'].includes(engine)) throw new Error(`translate returned unexpected engine ${engine || 'unknown'}`);
  if (output.toLowerCase() === sourceText.toLowerCase()) throw new Error('translate repeated source text');

  console.log(`OK production translation HTTP ${translated.response.status} engine=${engine} output_chars=${output.length}`);
  console.log('TRANSLATION_LIVE_SMOKE_OK');
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  try {
    await cleanup();
  } catch (cleanupError) {
    if (!primaryError) throw cleanupError;
    console.error(`Cleanup after failed smoke also failed: ${cleanupError.message}`);
  }
}

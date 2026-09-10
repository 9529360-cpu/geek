import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const apiBase = (process.env.GEEK_SUBSCRIPTION_API_URL || 'https://geek-subscription.9529360.workers.dev').replace(/\/+$/, '');
const infraToken = process.env.CLOUDFLARE_INFRA_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const accountNoPattern = /^GK-[0-9a-f]{32}$/;

if (!infraToken) throw new Error('Missing CLOUDFLARE_INFRA_API_TOKEN');
if (!accountId) throw new Error('Missing CLOUDFLARE_ACCOUNT_ID');

const wrangler = await readFile(new URL('../wrangler-subscription.toml', import.meta.url), 'utf8');
const databaseId = wrangler.match(/database_id\s*=\s*"([0-9a-f-]{36})"/i)?.[1];
if (!databaseId) throw new Error('Unable to resolve D1 database_id from wrangler-subscription.toml');

const suffix = `${Date.now()}-${randomBytes(5).toString('hex')}`;
const email = `smoke-${suffix}@example.invalid`;
const password = `Gk!${randomBytes(24).toString('base64url')}`;
let registered = false;
let registeredUserId = null;
let registeredAccountNo = null;

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
  console.log(`OK ${label} HTTP ${result.response.status}`);
}

function requireAccountNo(label, value) {
  if (!accountNoPattern.test(String(value || ''))) throw new Error(`${label} returned invalid account_no`);
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
  if (!ok) throw new Error(`Cleanup failed (HTTP ${response.status})`);
  console.log('OK transient test account cleanup');
}

try {
  const register = await jsonRequest(`${apiBase}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  requireOk('register', register);
  if (!Number.isSafeInteger(Number(register.payload?.userId)) || Number(register.payload.userId) < 1) throw new Error('register returned invalid userId');
  requireAccountNo('register', register.payload?.account_no);
  registered = true;
  registeredUserId = Number(register.payload.userId);
  registeredAccountNo = String(register.payload.account_no);

  const login = await jsonRequest(`${apiBase}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  requireOk('login', login);
  if (typeof login.payload?.token !== 'string' || login.payload.token.length < 40) throw new Error('login returned invalid token');
  if (Number(login.payload?.user?.id) !== registeredUserId || login.payload?.user?.email !== email) throw new Error('login returned mismatched user identity');
  requireAccountNo('login', login.payload?.user?.account_no);
  if (login.payload.user.account_no !== registeredAccountNo) throw new Error('register/login account_no mismatch');
  const setCookie = login.response.headers.get('set-cookie') || '';
  for (const required of ['HttpOnly', 'Secure', 'SameSite=Strict']) if (!setCookie.includes(required)) throw new Error(`login cookie missing ${required}`);

  const authHeaders = { Authorization: `Bearer ${login.payload.token}` };
  const status = await jsonRequest(`${apiBase}/api/status`, { headers: authHeaders });
  requireOk('status', status);
  if (!Number.isFinite(Number(status.payload?.remaining_chars))) throw new Error('status returned invalid remaining_chars');

  const me = await jsonRequest(`${apiBase}/api/me`, { headers: authHeaders });
  requireOk('me', me);
  if (Number(me.payload?.user?.id) !== registeredUserId || me.payload?.user?.email !== email) throw new Error('me returned mismatched user identity');
  requireAccountNo('me', me.payload?.user?.account_no);
  if (me.payload.user.account_no !== registeredAccountNo) throw new Error('register/login/me account_no mismatch');

  console.log('OK account_no format and register/login/me consistency');
  console.log('ACCOUNT_LIVE_SMOKE_OK');
} finally {
  await cleanup();
}

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

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function d1Query(sql, params = []) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${infraToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    }
  );
  const payload = await response.json().catch(() => ({}));
  const ok = response.ok && payload?.success !== false && Array.isArray(payload?.result) && payload.result.every((item) => item?.success !== false);
  if (!ok) throw new Error(`D1 query failed (HTTP ${response.status})`);
  return payload.result[0]?.results || [];
}

const translateHealth = await jsonRequest(`${translateBase}/health`);
console.log(`TRANSLATE_HEALTH HTTP ${translateHealth.response.status} ok=${String(translateHealth.payload?.ok)} providers=${Array.isArray(translateHealth.payload?.providers) ? translateHealth.payload.providers.join(',') : 'unknown'}`);
if (translateHealth.payload?.models && typeof translateHealth.payload.models === 'object') {
  for (const [id, state] of Object.entries(translateHealth.payload.models)) {
    console.log(`MODEL ${id} healthy=${String(state?.healthy)} failCount=${Number(state?.failCount || 0)} lastOkAt=${String(state?.lastOkAt || '')} lastFailAt=${String(state?.lastFailAt || '')} lastError=${String(state?.lastError || '').slice(0, 120)}`);
  }
}

const subscriptionHealth = await jsonRequest(`${subscriptionBase}/health`);
console.log(`SUBSCRIPTION_HEALTH HTTP ${subscriptionHealth.response.status} ok=${String(subscriptionHealth.payload?.ok)}`);

const recent = await d1Query(`
  SELECT status,
         COUNT(*) AS request_count,
         MAX(created_at) AS latest_created_at,
         MAX(completed_at) AS latest_completed_at
  FROM translation_usage
  WHERE created_at >= datetime('now', '-15 minutes')
  GROUP BY status
  ORDER BY status;
`);
console.log(`D1_RECENT_15M ${JSON.stringify(recent)}`);

const latest = await d1Query(`
  SELECT status, created_at, completed_at, reserved_chars, target_chars
  FROM translation_usage
  ORDER BY created_at DESC
  LIMIT 8;
`);
console.log(`D1_LATEST ${JSON.stringify(latest)}`);

const overall = await d1Query(`
  SELECT COUNT(*) AS total_requests,
         MAX(created_at) AS last_received_at,
         MAX(completed_at) AS last_completed_at
  FROM translation_usage;
`);
console.log(`D1_OVERALL ${JSON.stringify(overall)}`);

if (!translateHealth.response.ok || translateHealth.payload?.ok !== true) {
  throw new Error('translation Worker health is not OK');
}
if (!subscriptionHealth.response.ok || subscriptionHealth.payload?.ok !== true) {
  throw new Error('subscription Worker health is not OK');
}

console.log('TRANSLATION_RECEIPT_PROBE_OK');

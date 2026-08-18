import { writeFileSync } from 'node:fs';

const API_BASE = 'https://api.cloudflare.com/client/v4';
const token = process.env.CLOUDFLARE_INFRA_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const summaryPath = process.env.CLOUDFLARE_INFRA_SUMMARY_PATH || 'infra-smoke-summary.md';

if (!token) throw new Error('Missing CLOUDFLARE_INFRA_API_TOKEN');
if (!accountId) throw new Error('Missing CLOUDFLARE_ACCOUNT_ID');

const results = [];

async function request(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Response bodies are intentionally omitted from logs and summaries.
  }

  const ok = response.ok && payload?.success !== false;
  return {
    ok,
    status: response.status,
    result: payload?.result
  };
}

async function check(label, path) {
  const response = await request(path);
  results.push({ label, ok: response.ok, status: response.status });
  console.log(`${response.ok ? 'OK' : 'FAIL'} ${label} HTTP ${response.status}`);
  return response;
}

function skip(label) {
  results.push({ label, ok: false, status: 'SKIP' });
  console.log(`SKIP ${label}`);
}

function writeSummary() {
  const lines = [
    '### Cloudflare infrastructure access',
    '',
    '| Check | Result | HTTP |',
    '|---|---:|---:|',
    ...results.map(({ label, ok, status }) => `| ${label} | ${ok ? 'OK' : status === 'SKIP' ? 'SKIP' : 'FAIL'} | ${status} |`),
    '',
    'This report contains no token values, authorization headers, DNS record values, database contents, or Cloudflare response bodies.'
  ];
  writeFileSync(summaryPath, `${lines.join('\n')}\n`, 'utf8');
}

const tokenStatus = await check('API token active', '/user/tokens/verify');

let zoneId = null;
if (tokenStatus.ok) {
  const zoneResponse = await request(`/zones?name=bbnba.com&account.id=${encodeURIComponent(accountId)}&per_page=1`);
  const zoneFound = zoneResponse.ok && Array.isArray(zoneResponse.result) && zoneResponse.result.length === 1 && zoneResponse.result[0]?.name === 'bbnba.com';
  results.push({ label: 'Zone bbnba.com', ok: zoneFound, status: zoneResponse.status });
  console.log(`${zoneFound ? 'OK' : 'FAIL'} Zone bbnba.com HTTP ${zoneResponse.status}`);
  if (zoneFound) zoneId = zoneResponse.result[0].id;
} else {
  skip('Zone bbnba.com');
}

await check('D1', `/accounts/${accountId}/d1/database?per_page=1`);
await check('R2', `/accounts/${accountId}/r2/buckets?per_page=1`);
await check('KV', `/accounts/${accountId}/storage/kv/namespaces?per_page=1`);
await check('Workers scripts', `/accounts/${accountId}/workers/scripts`);
await check('Cloudflare Pages', `/accounts/${accountId}/pages/projects?per_page=1`);

if (zoneId) {
  await check('DNS records', `/zones/${zoneId}/dns_records?per_page=1`);
  await check('Workers routes', `/zones/${zoneId}/workers/routes`);
  await check('Zone settings', `/zones/${zoneId}/settings`);
} else {
  skip('DNS records');
  skip('Workers routes');
  skip('Zone settings');
}

writeSummary();

const failed = results.filter(({ ok }) => !ok);
if (failed.length > 0) {
  console.error(`CLOUDFLARE_INFRA_SMOKE_FAILED ${failed.map(({ label }) => label).join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('CLOUDFLARE_INFRA_SMOKE_OK');
}

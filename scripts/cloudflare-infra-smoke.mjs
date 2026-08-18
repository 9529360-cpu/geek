const API_BASE = 'https://api.cloudflare.com/client/v4';
const token = process.env.CLOUDFLARE_INFRA_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

if (!token) throw new Error('Missing CLOUDFLARE_INFRA_API_TOKEN');
if (!accountId) throw new Error('Missing CLOUDFLARE_ACCOUNT_ID');

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
    // Keep response bodies out of CI logs. Status is enough for this smoke check.
  }

  if (!response.ok || payload?.success === false) {
    const errors = Array.isArray(payload?.errors)
      ? payload.errors.map(({ code, message }) => ({ code, message }))
      : [];
    throw new Error(`Cloudflare API check failed for ${path} (HTTP ${response.status}) ${JSON.stringify(errors)}`);
  }

  return payload?.result;
}

async function check(label, path) {
  await request(path);
  console.log(`OK ${label}`);
}

await check('API token active', '/user/tokens/verify');

const zones = await request(`/zones?name=bbnba.com&account.id=${encodeURIComponent(accountId)}&per_page=1`);
if (!Array.isArray(zones) || zones.length !== 1 || zones[0]?.name !== 'bbnba.com') {
  throw new Error('Cloudflare token cannot resolve the bbnba.com zone in the configured account');
}
const zoneId = zones[0].id;
console.log('OK zone bbnba.com');

await check('D1', `/accounts/${accountId}/d1/database?per_page=1`);
await check('R2', `/accounts/${accountId}/r2/buckets?per_page=1`);
await check('KV', `/accounts/${accountId}/storage/kv/namespaces?per_page=1`);
await check('Workers scripts', `/accounts/${accountId}/workers/scripts`);
await check('Cloudflare Pages', `/accounts/${accountId}/pages/projects?per_page=1`);
await check('DNS records', `/zones/${zoneId}/dns_records?per_page=1`);
await check('Workers routes', `/zones/${zoneId}/workers/routes`);
await check('Zone settings', `/zones/${zoneId}/settings`);

console.log('CLOUDFLARE_INFRA_SMOKE_OK');

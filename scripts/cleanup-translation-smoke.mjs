const token = String(process.env.CLOUDFLARE_INFRA_API_TOKEN || '');
const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '');
if (!token || !accountId) throw new Error('missing Cloudflare cleanup credentials');

const databaseId = '1e78a93a-36de-43db-88aa-4551f9991200';
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
const pattern = 'translation-smoke-%@example.invalid';

async function run(sql) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params: [pattern] }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false || !Array.isArray(payload?.result) || payload.result.some(item => item?.success === false)) {
    throw new Error(`cleanup query failed: HTTP ${response.status}`);
  }
}

await run('DELETE FROM translation_usage WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)');
await run('DELETE FROM users WHERE email LIKE ?');
console.log('TRANSLATION_SMOKE_CLEANUP_OK');

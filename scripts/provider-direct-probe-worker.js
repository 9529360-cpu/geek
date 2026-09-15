const PROVIDERS = [
  {
    id: 'gemini',
    model: 'gemini-3.6-flash',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY',
  },
  {
    id: 'mistral',
    model: 'mistral-small-latest',
    base: 'https://api.mistral.ai/v1',
    keyEnv: 'MISTRAL_API_KEY',
  },
  {
    id: 'glm',
    model: 'glm-4.7-flash',
    base: 'https://api.z.ai/api/paas/v4',
    keyEnv: 'ZAI_API_KEY',
  },
];

async function probe(provider, env) {
  const key = env[provider.keyEnv];
  if (!key) return { provider: provider.id, configured: false, status: 0, ok: false, classification: 'missing_secret' };
  try {
    const response = await fetch(`${provider.base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: provider.model,
        temperature: 0,
        max_tokens: 8,
        messages: [
          { role: 'system', content: 'Reply with exactly OK.' },
          { role: 'user', content: 'ping' },
        ],
      }),
    });
    const raw = await response.text().catch(() => '');
    let classification = 'ok';
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) classification = 'auth';
      else if (response.status === 404) classification = 'model_or_endpoint';
      else if (response.status === 429) classification = 'quota_or_rate_limit';
      else if (response.status >= 500) classification = 'provider_server';
      else classification = 'provider_rejected';
    }
    return {
      provider: provider.id,
      configured: true,
      status: response.status,
      ok: response.ok,
      classification,
      bodyHint: raw.slice(0, 180).replace(/[A-Za-z0-9_\-]{24,}/g, '[redacted]'),
    };
  } catch (error) {
    return {
      provider: provider.id,
      configured: true,
      status: 0,
      ok: false,
      classification: 'network',
      bodyHint: String(error?.message || error).slice(0, 180),
    };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/provider-direct-probe') return new Response('not found', { status: 404 });
    const results = [];
    for (const provider of PROVIDERS) results.push(await probe(provider, env));
    return Response.json({ results });
  },
};

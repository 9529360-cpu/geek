// geek-translate Worker —— 极客翻译网关云端版（协议对齐 local_translation_gateway.py）
// 路由：GET /health、POST /v1/translate
// 上游：免费模型轮换池（GLM → Groq → Gemini → Mistral），限流/失败自动切换下一个，无付费上游
// 配置：各上游 API Key 从环境变量读取（GLM=ZAI_API_KEY, Groq=GROQ_API_KEY, Gemini=GEMINI_API_KEY, Mistral=MISTRAL_API_KEY），不写入代码

const LANG_NAMES = {
  zh: 'Simplified Chinese', en: 'English', it: 'Italian', es: 'Spanish',
  fr: 'French', de: 'German', pt: 'Portuguese', ja: 'Japanese',
  ko: 'Korean', hi: 'Hindi', ar: 'Arabic', ru: 'Russian',
  id: 'Indonesian', pl: 'Polish', tr: 'Turkish', vi: 'Vietnamese',
  nl: 'Dutch', sv: 'Swedish', el: 'Greek', th: 'Thai',
};

// 免费模型池（按顺序尝试；429/5xx/超时/空响应 → 自动切换下一个）
const PROVIDERS = [
  { id: 'glm',    model: 'glm-4.7-flash',          base: 'https://api.z.ai/api/paas/v4',           keyEnv: 'ZAI_API_KEY' },
  { id: 'groq',   model: 'llama-3.3-70b-versatile', base: 'https://api.groq.com/openai/v1',         keyEnv: 'GROQ_API_KEY' },
  { id: 'gemini', model: 'gemini-2.0-flash',        base: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'GEMINI_API_KEY' },
  { id: 'mistral', model: 'mistral-small-latest',   base: 'https://api.mistral.ai/v1',              keyEnv: 'MISTRAL_API_KEY' },
];

const enc = new TextEncoder();

function bytesToB64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64UrlToBytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
async function verifyTranslationJwt(token, secret) {
  try {
    if (!secret || !token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const data = `${parts[0]}.${parts[1]}`;
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('HMAC', key, b64UrlToBytes(parts[2]), enc.encode(data));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64UrlToBytes(parts[1])));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now || payload.iat > now + 30 || payload.aud !== 'geek-translate' || payload.purpose !== 'translate' || !Number.isInteger(payload.uid)) return null;
    return payload;
  } catch { return null; }
}

function bearer(request) {
  const match = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function countChars(text) {
  let total = 0;
  for (const char of String(text || '')) total += char.codePointAt(0) > 127 ? 2 : 1;
  return total;
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

function corsHeaders(request, env) {
  const origin = request?.headers?.get('Origin') || '';
  const allowed = String(env?.ALLOWED_ORIGIN || '').split(',').map(v => v.trim()).filter(Boolean);
  const headers = { 'Vary': 'Origin' };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(payload, status = 200, request = null, env = null) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(request, env) },
  });
}

function handleOptions(request, env) {
  const cors = corsHeaders(request, env);
  if (!cors['Access-Control-Allow-Origin']) return new Response(null, { status: 403, headers: cors });
  return new Response(null, {
    status: 204,
    headers: {
      ...cors,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID',
    },
  });
}

async function health(env, request) {
  const hasProvider = PROVIDERS.some(p => Boolean(env[p.keyEnv]));
  const configured = Boolean(hasProvider && env.JWT_SECRET && env.geek_subscriptions);
  const providers = PROVIDERS.filter(p => Boolean(env[p.keyEnv])).map(p => p.id);
  return json({ ok: configured, service: 'geek-translate', providers }, configured ? 200 : 503, request, env);
}

async function rateLimited(db, bucket, limit, windowSeconds) {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 19).replace('T', ' ');
  const cutoff = new Date(now.getTime() - windowSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const row = await db.prepare('SELECT count, updated_at FROM rate_limits WHERE bucket = ?').bind(bucket).first();
  if (!row || row.updated_at < cutoff) {
    await db.prepare('INSERT INTO rate_limits (bucket, count, updated_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET count = 1, updated_at = excluded.updated_at').bind(bucket, stamp).run();
    return false;
  }
  if (row.count >= limit) return true;
  await db.prepare('UPDATE rate_limits SET count = count + 1, updated_at = ? WHERE bucket = ?').bind(stamp, bucket).run();
  return false;
}

async function reserveUsage(db, userId, requestId, chars) {
  try {
    const results = await db.batch([
      db.prepare("INSERT INTO translation_usage (request_id, user_id, reserved_chars, status) VALUES (?, ?, ?, 'reserved')").bind(requestId, userId, chars),
      db.prepare("UPDATE users SET quota_chars = quota_chars - ? WHERE id = ? AND status = 'active' AND quota_chars >= ?").bind(chars, userId, chars),
    ]);
    if (!results[1]?.meta?.changes) {
      await db.prepare('DELETE FROM translation_usage WHERE request_id = ?').bind(requestId).run();
      return { ok: false, error: 'quota_exhausted' };
    }
  } catch {
    return { ok: false, error: 'duplicate_request' };
  }
  return { ok: true };
}

async function refundUsage(db, userId, requestId, chars) {
  await db.batch([
    db.prepare('UPDATE users SET quota_chars = quota_chars + ? WHERE id = ?').bind(chars, userId),
    db.prepare('DELETE FROM translation_usage WHERE request_id = ?').bind(requestId),
  ]);
}

async function finishUsage(db, userId, requestId, targetChars) {
  await db.batch([
    db.prepare('UPDATE users SET quota_chars = MAX(0, quota_chars - ?) WHERE id = ?').bind(targetChars, userId),
    db.prepare("UPDATE translation_usage SET target_chars = ?, status = 'complete', completed_at = datetime('now') WHERE request_id = ?").bind(targetChars, requestId),
  ]);
}

function buildMessages(text, target) {
  const language = LANG_NAMES[target] || target;
  return [
    { role: 'system', content: `You are a professional translator. Translate the user text faithfully into ${language} (${target}). Preserve all original formatting, line breaks, emojis, special characters, names, numbers, dates, URLs, punctuation and professional terminology. Adapt naturally to local expressions and cultural context while matching the original tone and level of formality. Do not explain. Output only the ${language} translation.` },
    { role: 'user', content: text },
  ];
}

// 调单个免费模型；非 2xx / 超时 / 空响应 → 抛错（上层轮换）
async function callProvider(provider, env, text, target, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = {
      model: provider.model,
      temperature: 0,
      max_tokens: 2000,
      messages: buildMessages(text, target),
    };
    const res = await fetch(`${provider.base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env[provider.keyEnv]}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      // 429/5xx = 限流或故障，交给上层切换；4xx 其他也切换（如 401 说明 key 失效）
      throw new Error(`${provider.id}: ${res.status} ${raw.slice(0, 100)}`);
    }
    const data = await res.json();
    const result = ((data.choices || [])[0] || {}).message?.content?.trim();
    if (!result) throw new Error(`${provider.id}: empty response`);
    return { text: result, engine: provider.id };
  } finally {
    clearTimeout(timer);
  }
}

// 多免费模型轮换：按 PROVIDERS 顺序尝试，全部失败抛最后错误
async function translate(text, target, env) {
  const pool = PROVIDERS.filter(p => Boolean(env[p.keyEnv]));
  if (!pool.length) throw new Error('no free provider configured');
  let lastError = null;
  for (const provider of pool) {
    try {
      return await callProvider(provider, env, text, target);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('all free providers failed');
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return handleOptions(request, env);
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'GET' && path === '/health') {
      return health(env, request);
    }

    if (request.method === 'POST' && path === '/v1/translate') {
      const auth = await verifyTranslationJwt(bearer(request), env.JWT_SECRET);
      if (!auth) return json({ error: 'unauthorized' }, 401, request, env);
      const requestId = String(request.headers.get('X-Request-ID') || '');
      if (!/^[0-9a-f-]{36}$/i.test(requestId)) return json({ error: 'invalid_request_id' }, 400, request, env);
      const db = env.geek_subscriptions;
      if (!db) return json({ error: 'service_unavailable' }, 503, request, env);
      if (await rateLimited(db, `translate:user:${auth.uid}`, 30, 60) || await rateLimited(db, `translate:ip:${clientIp(request)}`, 60, 60)) {
        return json({ error: 'rate_limited' }, 429, request, env);
      }
      let reserved = 0;
      try {
        const contentLength = Number(request.headers.get('Content-Length') || 0);
        if (contentLength > 32768) return json({ error: 'payload_too_large' }, 413, request, env);
        const body = await request.json();
        const text = String(body.text || '');
        const source = String(body.source || 'auto');
        const target = String(body.target || '').toLowerCase();
        const provider = String(body.provider || 'local').toLowerCase();
        const route = String(body.route || 'default').toLowerCase();
        if (provider !== 'auto' && provider !== 'local') return json({ error: 'unsupported_provider' }, 400, request, env);
        if (route !== 'default' && route !== 'primary' && route !== 'backup') return json({ error: 'invalid_route' }, 400, request, env);
        if (!text.trim()) return json({ error: 'empty_text' }, 400, request, env);
        if (text.length > 10000 || enc.encode(text).byteLength > 32768) return json({ error: 'payload_too_large' }, 413, request, env);
        if (!LANG_NAMES[target] || target === 'auto') return json({ error: 'invalid_target' }, 400, request, env);
        if (!PROVIDERS.some(p => Boolean(env[p.keyEnv]))) return json({ error: 'service_unavailable' }, 503, request, env);
        reserved = Math.max(1, countChars(text));
        const reservation = await reserveUsage(db, auth.uid, requestId, reserved);
        if (!reservation.ok) return json({ error: reservation.error }, reservation.error === 'duplicate_request' ? 409 : 402, request, env);
        const { text: result, engine } = await translate(text, target, env);
        await finishUsage(db, auth.uid, requestId, countChars(result));
        return json({ text: result, source, target, engine, route }, 200, request, env);
      } catch (error) {
        if (reserved > 0) await refundUsage(db, auth.uid, requestId, reserved).catch(() => {});
        return json({ error: 'translation_failed' }, 502, request, env);
      }
    }

    return json({ error: 'not_found' }, 404, request, env);
  },
};

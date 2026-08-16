// geek-translate Worker —— 极客翻译网关云端版（协议对齐 local_translation_gateway.py）
// 路由：GET /health、POST /v1/translate
// 上游：DeepSeek（OpenAI 兼容），API Key 从环境变量 DEEPSEEK_API_KEY 读取（不写入代码）

const LANG_NAMES = {
  zh: 'Simplified Chinese', en: 'English', it: 'Italian', es: 'Spanish',
  fr: 'French', de: 'German', pt: 'Portuguese', ja: 'Japanese',
  ko: 'Korean', hi: 'Hindi', ar: 'Arabic', ru: 'Russian',
  id: 'Indonesian', pl: 'Polish', tr: 'Turkish', vi: 'Vietnamese',
  nl: 'Dutch', sv: 'Swedish', el: 'Greek', th: 'Thai',
};

const MODEL = 'deepseek-chat';
const BASE = 'https://api.deepseek.com';

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });
}

function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Geek-Client',
    },
  });
}

async function health(env) {
  if (!env.DEEPSEEK_API_KEY) return json({ ok: false, pool: true, models: 0 }, 503);
  try {
    const res = await fetch(`${BASE}/v1/models`, {
      headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
    });
    if (!res.ok) return json({ ok: false, pool: true, models: 0 }, 503);
    const data = await res.json();
    // key 有效即可视为健康；models 取实际模型数（DeepSeek 固定返回 chat/reasoner）
    const count = Array.isArray(data.data) ? data.data.length : 1;
    return json({ ok: true, pool: true, models: count || 1 });
  } catch {
    return json({ ok: false, pool: true, models: 0 }, 503);
  }
}

async function translate(text, target, route, env) {
  const language = LANG_NAMES[target] || target;
  const body = {
    model: MODEL,
    temperature: 0,
    max_tokens: 2000,
    messages: [
      { role: 'system', content: `You are a professional translator. Translate the user text faithfully into ${language} (${target}). Preserve all original formatting, line breaks, emojis, special characters, names, numbers, dates, URLs, punctuation and professional terminology. Adapt naturally to local expressions and cultural context while matching the original tone and level of formality. Do not explain. Output only the ${language} translation.` },
      { role: 'user', content: text },
    ],
  };
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    throw new Error(`deepseek: ${res.status} ${raw.slice(0, 120)}`);
  }
  const data = await res.json();
  const result = ((data.choices || [])[0] || {}).message?.content?.trim();
  if (!result) throw new Error('deepseek: empty response');
  return { text: result, engine: MODEL, route };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return handleOptions();
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'GET' && path === '/health') {
      return health(env);
    }

    if (request.method === 'POST' && path === '/v1/translate') {
      try {
        const body = await request.json();
        const text = String(body.text || '');
        const source = String(body.source || 'auto');
        const target = String(body.target || '').toLowerCase();
        const provider = String(body.provider || 'local').toLowerCase();
        const route = String(body.route || 'default').toLowerCase();
        if (provider !== 'auto' && provider !== 'local') return json({ error: 'unsupported_provider' }, 400);
        if (route !== 'default' && route !== 'primary' && route !== 'backup') return json({ error: 'invalid_route' }, 400);
        if (!text.trim()) return json({ error: 'empty_text' }, 400);
        if (!target || target === 'auto') return json({ error: 'invalid_target' }, 400);
        if (!env.DEEPSEEK_API_KEY) return json({ error: 'missing_api_key' }, 503);
        const { text: result, engine, route: usedRoute } = await translate(text, target, route, env);
        return json({ text: result, source, target, engine, route: usedRoute });
      } catch (error) {
        return json({ error: String(error.message || error).slice(0, 200) }, 502);
      }
    }

    return json({ error: 'not_found' }, 404);
  },
};

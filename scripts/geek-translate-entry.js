import baseWorker from './geek-translate-worker.js';
import {
  normalizeTranslationIntent,
  scopeTranslationRateLimitAuthority,
} from './translation-rate-limit-compat.mjs';

const TRANSLATION_INTENT_HEADER = 'X-Geek-Translation-Intent';

function withTranslationDatabase(env, db) {
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === 'geek_subscriptions') return db;
      return Reflect.get(target, property, receiver);
    },
  });
}

async function sanitizePublicHealthResponse(response) {
  const payload = await response.clone().json().catch(() => null);
  if (!payload || typeof payload !== 'object' || !payload.models || typeof payload.models !== 'object') {
    return response;
  }

  const safeModels = {};
  for (const [provider, state] of Object.entries(payload.models)) {
    if (!state || typeof state !== 'object') {
      safeModels[provider] = state;
      continue;
    }
    const { lastError: _lastError, ...safeState } = state;
    safeModels[provider] = safeState;
  }

  return new Response(JSON.stringify({ ...payload, models: safeModels }), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const db = env.geek_subscriptions;
    const intent = normalizeTranslationIntent(request.headers.get(TRANSLATION_INTENT_HEADER));
    const workerEnv = db && typeof db.prepare === 'function'
      ? withTranslationDatabase(env, scopeTranslationRateLimitAuthority(db, { intent }))
      : env;
    const response = await baseWorker.fetch(request, workerEnv, ctx);
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return sanitizePublicHealthResponse(response);
    }
    return response;
  },

  async scheduled(controller, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') {
      const db = env.geek_subscriptions;
      const scopedEnv = db && typeof db.prepare === 'function'
        ? withTranslationDatabase(env, scopeTranslationRateLimitAuthority(db))
        : env;
      return baseWorker.scheduled(controller, scopedEnv, ctx);
    }
  },
};

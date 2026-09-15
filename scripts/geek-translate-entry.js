import baseWorker from './geek-translate-worker.js';
import { scopeTranslationRateLimitAuthority } from './translation-rate-limit-compat.mjs';
import {
  recoverStaleTranslationReservations,
  staleTranslationReservationSummary,
} from './translation-reservation-recovery.mjs';

const enc = new TextEncoder();

function withTranslationDatabase(env, db) {
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === 'geek_subscriptions') return db;
      return Reflect.get(target, property, receiver);
    },
  });
}

function b64UrlToBytes(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function verifiedTranslationUserId(request, secret) {
  try {
    if (!secret) return null;
    const match = String(request?.headers?.get?.('Authorization') || '').match(/^Bearer\s+(.+)$/i);
    if (!match) return null;
    const parts = match[1].split('.');
    if (parts.length !== 3) return null;
    const data = `${parts[0]}.${parts[1]}`;
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('HMAC', key, b64UrlToBytes(parts[2]), enc.encode(data));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64UrlToBytes(parts[1])));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now || payload.iat > now + 30 || payload.aud !== 'geek-translate' || payload.purpose !== 'translate' || !Number.isInteger(payload.uid)) return null;
    return payload.uid;
  } catch {
    return null;
  }
}

async function sanitizePublicHealthResponse(response, db) {
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
  const staleReservations = await staleTranslationReservationSummary(db).catch(() => ({ count: 0, oldestAgeSeconds: 0 }));

  return new Response(JSON.stringify({ ...payload, models: safeModels, staleReservations }), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const db = env.geek_subscriptions;
    const workerDb = db && typeof db.prepare === 'function'
      ? scopeTranslationRateLimitAuthority(db)
      : db;
    const workerEnv = workerDb ? withTranslationDatabase(env, workerDb) : env;
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/v1/translate' && workerDb) {
      const userId = await verifiedTranslationUserId(request, env.JWT_SECRET);
      if (userId) {
        await recoverStaleTranslationReservations(workerDb, { userId, limit: 8 }).catch(() => {});
      }
    }

    const response = await baseWorker.fetch(request, workerEnv, ctx);
    if (request.method === 'GET' && url.pathname === '/health') {
      return sanitizePublicHealthResponse(response, workerDb);
    }
    return response;
  },

  async scheduled(controller, env, ctx) {
    const db = env.geek_subscriptions;
    const scopedEnv = db && typeof db.prepare === 'function'
      ? withTranslationDatabase(env, scopeTranslationRateLimitAuthority(db))
      : env;
    if (db && typeof db.prepare === 'function') {
      await recoverStaleTranslationReservations(scopedEnv.geek_subscriptions, { limit: 50 }).catch(() => {});
    }
    if (typeof baseWorker.scheduled === 'function') {
      return baseWorker.scheduled(controller, scopedEnv, ctx);
    }
  },
};

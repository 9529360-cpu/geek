import baseWorker from './geek-translate-worker.js';
import {
  purgeExpiredTranslationReplays,
  recoverStaleTranslationReservations,
  staleTranslationReservationSummary,
} from './translation-reservation-recovery.mjs';

const enc = new TextEncoder();

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
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/v1/translate' && db && typeof db.prepare === 'function') {
      const userId = await verifiedTranslationUserId(request, env.JWT_SECRET);
      if (userId) {
        await recoverStaleTranslationReservations(db, { userId, limit: 8 }).catch(() => {});
        await purgeExpiredTranslationReplays(db, { limit: 4 }).catch(() => {});
      }
    }

    const response = await baseWorker.fetch(request, env, ctx);
    if (request.method === 'GET' && url.pathname === '/health') {
      return sanitizePublicHealthResponse(response, db);
    }
    return response;
  },

  async scheduled(controller, env, ctx) {
    const db = env.geek_subscriptions;
    if (db && typeof db.prepare === 'function') {
      await recoverStaleTranslationReservations(db, { limit: 50 }).catch(() => {});
      await purgeExpiredTranslationReplays(db, { limit: 50 }).catch(() => {});
    }
    if (typeof baseWorker.scheduled === 'function') {
      return baseWorker.scheduled(controller, env, ctx);
    }
  },
};

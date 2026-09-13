import coreWorker from './geek-subscription-worker-core.js';
import {
  normalizeRequestedPayMethod,
  scopePendingOrderReuse,
  scopeUsdtOrderAmountAllocation,
  USDT_PAYMENT_SLOTS_EXHAUSTED,
} from './subscription-order-pay-method.mjs';
import {
  isLegacyRateLimitBypass,
  rateLimitRuleForRequest,
  requestRateLimited,
  scopeLegacyRateLimitBypass,
} from './atomic-rate-limit.mjs';

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function withSubscriptionDatabase(env, db) {
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === 'geek_subscriptions') return db;
      return Reflect.get(target, property, receiver);
    },
  });
}

function authProbeRequest(request) {
  const headers = new Headers();
  for (const name of ['Authorization', 'Cookie']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Request(new URL('/api/me', request.url), { method: 'GET', headers });
}

function csrfAllowed(request) {
  if (request.headers.get('Authorization')) return true;
  const origin = request.headers.get('Origin');
  return Boolean(origin && origin === new URL(request.url).origin);
}

async function authenticatedProfile(request, env, ctx) {
  const response = await coreWorker.fetch(authProbeRequest(request), env, ctx);
  if (!response.ok) return { response };
  const data = await response.clone().json().catch(() => ({}));
  return { response, user: data?.user || null };
}

async function invalidPayMethodResponse(request, env, ctx) {
  // Preserve the existing authentication boundary: unauthenticated requests
  // still receive the core Worker's auth response before input validation.
  const auth = await authenticatedProfile(request, env, ctx);
  if (!auth.response.ok) return auth.response;
  return json({ error: 'invalid_pay_method' }, 400);
}

async function legacyUsageCompatibilityResponse(request, env, ctx) {
  // Quota charging is owned by the authenticated translation gateway. Keep the
  // historical endpoint readable for older released clients, but never let it
  // reach the core Worker's obsolete second quota-decrement implementation.
  const auth = await authenticatedProfile(request, env, ctx);
  if (!auth.response.ok) return auth.response;
  if (!csrfAllowed(request)) return json({ error: 'invalid_origin' }, 403);

  const remaining = Number(auth.user?.quota_chars);
  return json({
    ok: true,
    remaining_chars: Number.isFinite(remaining) ? Math.max(0, Math.floor(remaining)) : 0,
    deducted: 0,
    deprecated: true,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let scopedEnv = env;
    const db = env.geek_subscriptions;

    // Direct calls to this wrapper still get the shared atomic gate. When the
    // production outer entry already gated the request it passes the marked bypass
    // database, so this layer must not consume a second attempt from the same bucket.
    if (rateLimitRuleForRequest(request) && !isLegacyRateLimitBypass(db)) {
      if (await requestRateLimited(request, db)) {
        return json({ error: 'rate_limited' }, 429);
      }
      scopedEnv = withSubscriptionDatabase(env, scopeLegacyRateLimitBypass(db));
    }

    if (request.method === 'POST' && url.pathname === '/api/usage') {
      return legacyUsageCompatibilityResponse(request, scopedEnv, ctx);
    }

    if (request.method !== 'POST' || url.pathname !== '/api/orders') {
      return coreWorker.fetch(request, scopedEnv, ctx);
    }

    const body = await request.clone().json().catch(() => ({}));
    const hasPayMethod = Boolean(body && typeof body === 'object' &&
      Object.prototype.hasOwnProperty.call(body, 'pay_method'));
    const payMethod = normalizeRequestedPayMethod(body?.pay_method, hasPayMethod);
    if (!payMethod) return invalidPayMethodResponse(request, scopedEnv, ctx);

    let scopedDb = scopePendingOrderReuse(scopedEnv.geek_subscriptions, payMethod);
    scopedDb = scopeUsdtOrderAmountAllocation(scopedDb, payMethod);
    try {
      return await coreWorker.fetch(request, withSubscriptionDatabase(scopedEnv, scopedDb), ctx);
    } catch (error) {
      if (error?.code === USDT_PAYMENT_SLOTS_EXHAUSTED) {
        return json({ error: 'payment_slots_exhausted' }, 409);
      }
      throw error;
    }
  },

  async scheduled(controller, env, ctx) {
    if (typeof coreWorker.scheduled === 'function') {
      return coreWorker.scheduled(controller, env, ctx);
    }
  },
};

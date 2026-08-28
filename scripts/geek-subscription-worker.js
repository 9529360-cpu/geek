import coreWorker from './geek-subscription-worker-core.js';
import {
  normalizeRequestedPayMethod,
  scopePendingOrderReuse,
} from './subscription-order-pay-method.mjs';
import {
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

async function invalidPayMethodResponse(request, env, ctx) {
  // Preserve the existing authentication boundary: unauthenticated requests
  // still receive the core Worker's auth response before input validation.
  const authResponse = await coreWorker.fetch(authProbeRequest(request), env, ctx);
  if (!authResponse.ok) return authResponse;
  return json({ error: 'invalid_pay_method' }, 400);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let scopedEnv = env;

    // The core Worker still contains its legacy multi-statement limiter. Make the
    // shared one-statement gate authoritative first, then scope only this request's
    // rate-limit SQL to no-ops so the core cannot double-count the same attempt.
    if (rateLimitRuleForRequest(request)) {
      if (await requestRateLimited(request, env.geek_subscriptions)) {
        return json({ error: 'rate_limited' }, 429);
      }
      scopedEnv = withSubscriptionDatabase(
        env,
        scopeLegacyRateLimitBypass(env.geek_subscriptions)
      );
    }

    if (request.method !== 'POST' || url.pathname !== '/api/orders') {
      return coreWorker.fetch(request, scopedEnv, ctx);
    }

    const body = await request.clone().json().catch(() => ({}));
    const hasPayMethod = Boolean(body && typeof body === 'object' &&
      Object.prototype.hasOwnProperty.call(body, 'pay_method'));
    const payMethod = normalizeRequestedPayMethod(body?.pay_method, hasPayMethod);
    if (!payMethod) return invalidPayMethodResponse(request, scopedEnv, ctx);

    const scopedDb = scopePendingOrderReuse(scopedEnv.geek_subscriptions, payMethod);
    return coreWorker.fetch(request, withSubscriptionDatabase(scopedEnv, scopedDb), ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof coreWorker.scheduled === 'function') {
      return coreWorker.scheduled(controller, env, ctx);
    }
  },
};

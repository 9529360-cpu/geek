import productionEntry from './geek-subscription-entry.js';
import {
  clientIp,
  rateLimitRuleForRequest,
  requestRateLimited,
  scopeLegacyRateLimitBypass,
} from './atomic-rate-limit.mjs';
import {
  isAdminLoginRequest,
  reserveAdminLoginAttempt,
  scopeLegacyAdminLoginBypass,
} from './atomic-admin-login.mjs';

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

export default {
  async fetch(request, env, ctx) {
    const db = env.geek_subscriptions;

    if (isAdminLoginRequest(request)) {
      const admission = await reserveAdminLoginAttempt(db, clientIp(request));
      if (admission.blocked) return json({ error: 'too_many_attempts' }, 429);

      // The atomic admission above is now authoritative for this request. The scoped
      // D1 proxy suppresses only the old admin SELECT/lock/failure-increment queries;
      // the existing success DELETE is deliberately left real so a valid password
      // still clears the lock/failure state exactly as before.
      const scopedEnv = withSubscriptionDatabase(env, scopeLegacyAdminLoginBypass(db));
      return productionEntry.fetch(request, scopedEnv, ctx);
    }

    if (!rateLimitRuleForRequest(request)) {
      return productionEntry.fetch(request, env, ctx);
    }

    if (await requestRateLimited(request, db)) {
      return json({ error: 'rate_limited' }, 429);
    }

    // Production entry/core keep their existing auth/reset behavior. For this request
    // only, the marked database proxy turns their legacy multi-statement limiter into
    // a no-op because the shared atomic statement above already consumed the attempt.
    const scopedEnv = withSubscriptionDatabase(env, scopeLegacyRateLimitBypass(db));
    return productionEntry.fetch(request, scopedEnv, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof productionEntry.scheduled === 'function') {
      return productionEntry.scheduled(controller, env, ctx);
    }
  },
};

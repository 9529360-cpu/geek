import baseWorker from './geek-translate-worker.js';
import { scopeTranslationRateLimitAuthority } from './translation-rate-limit-compat.mjs';

function withTranslationDatabase(env, db) {
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
    if (!db || typeof db.prepare !== 'function') {
      return baseWorker.fetch(request, env, ctx);
    }
    const scopedDb = scopeTranslationRateLimitAuthority(db);
    return baseWorker.fetch(request, withTranslationDatabase(env, scopedDb), ctx);
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

import router from './geek-marketing-router.js';

export const WORKER_VERSION_HEADER = 'X-Geek-Worker-Version';

function workerVersionId(env) {
  return String(env?.CF_VERSION_METADATA?.id || '').trim();
}

export function attachWorkerVersion(response, env) {
  const versionId = workerVersionId(env);
  if (!versionId || !(response instanceof Response)) return response;
  const headers = new Headers(response.headers);
  headers.set(WORKER_VERSION_HEADER, versionId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    return attachWorkerVersion(await router.fetch(request, env, ctx), env);
  },
};

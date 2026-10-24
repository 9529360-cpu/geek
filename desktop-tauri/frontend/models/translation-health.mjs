import { translationError } from './translation.mjs';

const invalid = () => { throw 'NETWORK_RESPONSE_INVALID'; };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const latency = (value) => value === null || (Number.isSafeInteger(value) && value >= 0);

export function healthOf(value) {
  if (!exact(value, ['ok', 'endpointCount', 'availableCount', 'routes', 'recommendedRoute'])
      || typeof value.ok !== 'boolean' || !exact(value.routes, ['primary', 'backup'])) invalid();
  const routes = {};
  for (const name of ['primary', 'backup']) {
    const route = value.routes[name];
    if (!exact(route, ['configured', 'healthy', 'latencyMs', 'translationLatencyMs', 'code'])
        || typeof route.configured !== 'boolean' || typeof route.healthy !== 'boolean'
        || !latency(route.latencyMs) || !latency(route.translationLatencyMs)
        || !(route.code === null || (typeof route.code === 'string' && /^[A-Z_]{1,64}$/.test(route.code)))
        || (!route.configured && (route.healthy || route.latencyMs !== null || route.translationLatencyMs !== null || route.code !== null))
        || (route.healthy && route.code !== null)) invalid();
    routes[name] = { ...route };
  }
  const configured = Object.values(routes).filter((route) => route.configured).length;
  const available = Object.values(routes).filter((route) => route.healthy).length;
  if (value.endpointCount !== configured || value.availableCount !== available || value.ok !== (available > 0)
      || (value.recommendedRoute !== null && !['primary', 'backup'].includes(value.recommendedRoute))
      || (value.recommendedRoute !== null && !routes[value.recommendedRoute].healthy)
      || (available === 0 && value.recommendedRoute !== null)) invalid();
  return { ...value, routes };
}

export function healthStatus(health, error, checking) {
  if (checking) return { state: 'working', text: '正在检查网关连接和账户状态…' };
  if (error) return { state: 'error', text: error };
  if (!health) return { state: 'idle', text: '检查网关连接、登录和余额，不发送翻译请求。' };
  const parts = [];
  for (const [name, label] of [['primary', '主网关'], ['backup', '备用网关']]) {
    const route = health.routes[name];
    parts.push(!route.configured ? `${label}未配置。`
      : route.healthy ? `${label}可达${route.latencyMs === null ? '' : `，连接耗时 ${route.latencyMs} ms`}。`
        : `${label}暂不可用：${translationError(route.code || 'TRANSLATION_UNAVAILABLE')}`);
  }
  parts.push('本次只检测连接，未测量实际翻译耗时。');
  return { state: health.ok ? 'ok' : 'error', text: parts.join(' ') };
}

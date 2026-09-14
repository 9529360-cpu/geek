'use strict';
// 翻译网关端点池：多端点健康探测 + primary/backup 故障切换。
// 纯 Node 模块（不依赖 Electron），便于契约测试。

const DEFAULT_RECOVERY_PROBE_MS = 30000;
const VALID_ROUTES = new Set(['default', 'primary', 'backup']);

function createRouteError(route, configured) {
  const error = new Error(
    configured
      ? `${route === 'backup' ? '备用' : '主'}翻译线路暂不可用`
      : `${route === 'backup' ? '备用' : '主'}翻译线路尚未配置`
  );
  error.code = configured ? 'TRANSLATION_ROUTE_UNAVAILABLE' : 'TRANSLATION_ROUTE_NOT_CONFIGURED';
  error.category = 'gateway';
  error.retryable = configured;
  error.endpointFailure = false;
  error.route = route;
  return error;
}

function createGatewayPool({ endpoints, now = () => Date.now(), healthFetch = null, recoveryProbeMs = DEFAULT_RECOVERY_PROBE_MS }) {
  const parsedRecoveryProbeMs = Number(recoveryProbeMs);
  const recoveryDelay = Number.isFinite(parsedRecoveryProbeMs) && parsedRecoveryProbeMs >= 0
    ? parsedRecoveryProbeMs
    : DEFAULT_RECOVERY_PROBE_MS;
  const list = (endpoints || []).map((endpoint) => ({
    endpoint: String(endpoint).replace(/\/$/, ''),
    healthy: true,
    lastFailureAt: 0,
    probeInFlight: false,
  }));
  let unhealthyProbeCursor = 0;

  function healthOf(endpoint) {
    const item = list.find((x) => x.endpoint === endpoint);
    return item ? item.healthy : false;
  }

  function reportFailure(endpoint) {
    const item = list.find((x) => x.endpoint === endpoint);
    if (item) {
      item.healthy = false;
      item.lastFailureAt = now();
      item.probeInFlight = false;
    }
  }

  function reportSuccess(endpoint) {
    const item = list.find((x) => x.endpoint === endpoint);
    if (item) {
      item.healthy = true;
      item.lastFailureAt = 0;
      item.probeInFlight = false;
    }
  }

  function reportHealth(endpoint, healthy) {
    if (healthy) reportSuccess(endpoint); else reportFailure(endpoint);
  }

  function recoverable(item, currentTime) {
    return !item.healthy
      && !item.probeInFlight
      && currentTime - item.lastFailureAt >= recoveryDelay;
  }

  function normalizeRoute(route) {
    const value = String(route || 'default').toLowerCase();
    return VALID_ROUTES.has(value) ? value : 'default';
  }

  function candidatesFor(route) {
    if (route === 'primary') return list.slice(0, 1);
    if (route === 'backup') return list.slice(1);
    return list;
  }

  function routeAvailability() {
    return Object.freeze({ primary: list.length > 0, backup: list.length > 1 });
  }

  function pick(requestedRoute = 'default') {
    if (!list.length) throw new Error('翻译网关端点池为空');
    const route = normalizeRoute(requestedRoute);
    const candidates = candidatesFor(route);
    if (!candidates.length) throw createRouteError(route, false);

    const currentTime = now();
    const healthy = candidates.filter((x) => x.healthy);
    let item;

    if (healthy.length) {
      // 只在当前 route 的候选集合内做声明顺序优先和 half-open 探测。
      // 显式 primary/backup 永远不会悄悄越级到另一个 route class。
      const bestHealthyIndex = candidates.indexOf(healthy[0]);
      const probe = candidates.find((candidate, index) => index < bestHealthyIndex && recoverable(candidate, currentTime));
      if (probe) {
        probe.probeInFlight = true;
        item = probe;
      } else {
        item = healthy[0];
      }
      if (route === 'default') unhealthyProbeCursor = 0;
    } else if (route === 'default') {
      // 自动线路保持既有 best-effort 语义：全部 unhealthy 时按声明顺序轮转恢复。
      item = list[unhealthyProbeCursor % list.length];
      unhealthyProbeCursor = (unhealthyProbeCursor + 1) % list.length;
      item.probeInFlight = true;
    } else {
      // 用户显式锁定线路时，不跨线路兜底。只有冷却完成的同类端点可做 half-open 探测。
      const probe = candidates.find((candidate) => recoverable(candidate, currentTime));
      if (!probe) throw createRouteError(route, true);
      probe.probeInFlight = true;
      item = probe;
    }

    const isPrimary = item === list[0];
    return { endpoint: item.endpoint, route: isPrimary ? 'primary' : 'backup' };
  }

  async function healthCheckAll() {
    const results = {};
    if (!healthFetch) return results;
    await Promise.all(list.map(async (item) => {
      try {
        const res = await healthFetch(`${item.endpoint}/health`);
        reportHealth(item.endpoint, Boolean(res && res.ok));
        results[item.endpoint] = Boolean(res && res.ok);
      } catch {
        reportHealth(item.endpoint, false);
        results[item.endpoint] = false;
      }
    }));
    return results;
  }

  return {
    endpoints: list.map((x) => x.endpoint),
    healthOf,
    reportFailure,
    reportSuccess,
    reportHealth,
    routeAvailability,
    pick,
    healthCheckAll,
  };
}

module.exports = { DEFAULT_RECOVERY_PROBE_MS, createGatewayPool };

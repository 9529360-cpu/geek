'use strict';
// 翻译网关端点池：多端点健康探测 + primary/backup 故障切换。
// 纯 Node 模块（不依赖 Electron），便于契约测试。

const DEFAULT_RECOVERY_PROBE_MS = 30000;

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

  function pick() {
    if (!list.length) throw new Error('翻译网关端点池为空');
    const currentTime = now();
    const healthy = list.filter((x) => x.healthy);
    let item;

    if (healthy.length) {
      // 优先允许声明顺序更高的故障端点在冷却后做一次 half-open 探测；
      // probeInFlight 保证并发请求继续走健康 backup，不形成恢复惊群。
      const bestHealthyIndex = list.indexOf(healthy[0]);
      const probe = list.find((candidate, index) => index < bestHealthyIndex && recoverable(candidate, currentTime));
      if (probe) {
        probe.probeInFlight = true;
        item = probe;
      } else {
        item = healthy[0];
      }
      unhealthyProbeCursor = 0;
    } else {
      // 全部 unhealthy 时没有可保留的健康容量，继续按声明顺序轮转尽力恢复。
      item = list[unhealthyProbeCursor % list.length];
      unhealthyProbeCursor = (unhealthyProbeCursor + 1) % list.length;
      item.probeInFlight = true;
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

  return { endpoints: list.map((x) => x.endpoint), healthOf, reportFailure, reportSuccess, reportHealth, pick, healthCheckAll };
}

module.exports = { DEFAULT_RECOVERY_PROBE_MS, createGatewayPool };
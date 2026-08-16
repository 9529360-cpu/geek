'use strict';
// 翻译网关端点池：多端点健康探测 + primary/backup 故障切换。
// 纯 Node 模块（不依赖 Electron），便于契约测试。

function createGatewayPool({ endpoints, now = () => Date.now(), healthFetch = null }) {
  const list = (endpoints || []).map((endpoint) => ({
    endpoint: String(endpoint).replace(/\/$/, ''),
    healthy: true,
    lastFailureAt: 0
  }));

  function healthOf(endpoint) {
    const item = list.find((x) => x.endpoint === endpoint);
    return item ? item.healthy : false;
  }

  function reportFailure(endpoint) {
    const item = list.find((x) => x.endpoint === endpoint);
    if (item) { item.healthy = false; item.lastFailureAt = now(); }
  }

  function reportSuccess(endpoint) {
    const item = list.find((x) => x.endpoint === endpoint);
    if (item) { item.healthy = true; item.lastFailureAt = 0; }
  }

  function reportHealth(endpoint, healthy) {
    if (healthy) reportSuccess(endpoint); else reportFailure(endpoint);
  }

  function pick() {
    if (!list.length) throw new Error('翻译网关端点池为空');
    const healthy = list.filter((x) => x.healthy);
    // 健康端点中：第一个为 primary，其余 backup（按声明顺序）
    const ordered = healthy.length ? healthy : list;
    const item = ordered[0];
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

module.exports = { createGatewayPool };

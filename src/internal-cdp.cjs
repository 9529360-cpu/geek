'use strict';

const { EventEmitter } = require('node:events');

function storagePathLeaf(storagePath) {
  const value = String(storagePath || '').replace(/[\\/]+$/, '');
  if (!value) return '';
  const parts = value.split(/[\\/]/);
  return parts.at(-1) || '';
}

function createInternalCdp({ getAllWebContents, timeoutMs = 10000, externalDebugging = false }) {
  const manager = new EventEmitter();
  const partitionRuns = new Map();

  function isPlatformUrl(url, platform) {
    if (platform === 'whatsapp' || platform === 'whatsapp-pure') {
      return url.includes('web.whatsapp.com');
    }
    if (platform === 'telegram-z' || platform === 'telegram-k') {
      return url.includes('web.telegram.org');
    }
    if (platform === 'line' || platform === 'line-business') {
      return url.includes('chrome-extension') || url.includes('manager.line.biz') || url.includes('access.line.me');
    }
    return url.includes(platform);
  }

  function findGuest(partition, platform, preferredGuestId = null) {
    const partitionLeaf = partition.split(':').pop();
    const guests = getAllWebContents();
    const matches = (g) => {
      const gPartition = storagePathLeaf(g?.session?.storagePath);
      return gPartition === partitionLeaf && isPlatformUrl(g.getURL(), platform);
    };
    if (preferredGuestId !== null && preferredGuestId !== undefined) {
      const exact = guests.find(g => Number(g?.id) === Number(preferredGuestId));
      return exact && matches(exact) ? exact : null;
    }
    return guests.find(matches) || null;
  }

  function runExclusive(partition, task) {
    const key = String(partition || '');
    const previous = partitionRuns.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    let tracked;
    tracked = next.finally(() => {
      if (partitionRuns.get(key) === tracked) partitionRuns.delete(key);
    });
    partitionRuns.set(key, tracked);
    return tracked;
  }

  async function run(partition, platform, callback, preferredGuestId = null) {
    if (externalDebugging) {
      throw new Error('外部调试端口模式，禁止内部CDP');
    }
    return runExclusive(partition, async () => {
      const guest = findGuest(partition, platform, preferredGuestId);
      if (!guest) {
        throw new Error('未找到匹配的guest');
      }

      const wasAttached = guest.debugger.isAttached();
      if (!wasAttached) {
        await guest.debugger.attach('1.3');
      }

      try {
        const send = async (method, params = {}) => {
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('CDP命令超时')), timeoutMs);
            guest.debugger.sendCommand(method, params).then(
              (result) => { clearTimeout(timer); resolve(result); },
              (error) => { clearTimeout(timer); reject(error); }
            );
          });
        };

        const listeners = new Set();
        const onEvent = (handler) => {
          listeners.add(handler);
          return () => listeners.delete(handler);
        };
        const onMessage = (_event, method, params) => {
          for (const handler of listeners) {
            try { handler(method, params); } catch { /* 事件处理器异常不影响命令流 */ }
          }
        };
        guest.debugger.addListener('message', onMessage);
        try {
          return await callback({ send, onEvent });
        } finally {
          guest.debugger.removeListener('message', onMessage);
          listeners.clear();
        }
      } finally {
        if (!wasAttached) {
          await guest.debugger.detach();
        }
      }
    });
  }

  manager.findGuest = findGuest;
  manager.run = run;
  return manager;
}

module.exports = { createInternalCdp, storagePathLeaf };

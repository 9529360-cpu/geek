'use strict';

const { EventEmitter } = require('node:events');

function createInternalCdp({ getAllWebContents, timeoutMs = 10000, externalDebugging = false }) {
  const manager = new EventEmitter();

  function isPlatformUrl(url, platform) {
    if (platform === 'whatsapp' || platform === 'whatsapp-pure') {
      return url.includes('web.whatsapp.com') || url.includes('127.0.0.1:1843');
    }
    if (platform === 'telegram-z' || platform === 'telegram-k') {
      return url.includes('web.telegram.org');
    }
    if (platform === 'line' || platform === 'line-business') {
      return url.includes('chrome-extension') || url.includes('manager.line.biz') || url.includes('access.line.me');
    }
    return url.includes(platform);
  }

  function findGuest(partition, platform) {
    const partitionLeaf = partition.split(':').pop();
    const guests = getAllWebContents();
    return guests.find(g => {
      const gPartition = g.session.storagePath.split('Partitions/').pop();
      return gPartition === partitionLeaf && isPlatformUrl(g.getURL(), platform);
    }) || null;
  }

  async function run(partition, platform, callback) {
    if (externalDebugging) {
      throw new Error('外部调试端口模式，禁止内部CDP');
    }
    const guest = findGuest(partition, platform);
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

      return await callback(send);
    } finally {
      if (!wasAttached) {
        await guest.debugger.detach();
      }
    }
  }

  manager.findGuest = findGuest;
  manager.run = run;
  return manager;
}

module.exports = { createInternalCdp };

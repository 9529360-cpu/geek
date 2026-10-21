/* TG/LINE 访客可见翻译的 bounded admission：与 WhatsApp rehydrate 的后台准入（active 2 / queue 8）同预算。
 * 纯逻辑，不碰 DOM，可在访客页与 Node 测试里同款运行。
 * 访客内由宿主注入的工厂创建实例；工厂缺失时调用方直接回退到直调（现状行为），不阻塞翻译。
 * 语义：同一聊天内的可见翻译按提交顺序跑；队列满时丢最旧（静默丢弃，不报错）；
 * 聊天切换时，已排队、尚未执行的旧聊天工作静默丢弃；在途工作不受影响（与 WhatsApp 侧一致的残差）。
 * 用户主动点击的翻译不走 admission（交互行为，低频），只约束自动可见翻译的扇出。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekTranslationVisibleAdmissionFactory = api.createVisibleTranslationAdmission;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function createVisibleTranslationAdmission(options = {}) {
    const activeLimit = Math.max(1, Number(options.activeLimit) || 2);
    const queueLimit = Math.max(0, Number(options.queueLimit) || 8);
    let active = 0;
    let lastChatId = '';
    const queue = [];

    function discardQueued() {
      while (queue.length) {
        const item = queue.shift();
        try { item.resolve(false); } catch (_) {}
      }
    }

    function drain() {
      while (active < activeLimit && queue.length) {
        const item = queue.shift();
        if (item.chatId && item.chatId !== lastChatId) {
          try { item.resolve(false); } catch (_) {}
          continue;
        }
        active += 1;
        Promise.resolve()
          .then(() => item.work())
          .then(item.resolve, item.reject)
          .finally(() => {
            active = Math.max(0, active - 1);
            drain();
          });
      }
    }

    function submit(work, opts = {}) {
      if (typeof work !== 'function') return Promise.reject(new TypeError('admission work is required'));
      const chatId = typeof opts.chatId === 'string' ? opts.chatId : '';
      return new Promise((resolve, reject) => {
        if (chatId && chatId !== lastChatId) {
          lastChatId = chatId;
          discardQueued();
        }
        if (active >= activeLimit && queueLimit <= 0) {
          resolve(false);
          return;
        }
        if (queue.length >= queueLimit) {
          const dropped = queue.shift();
          if (dropped) {
            try { dropped.resolve(false); } catch (_) {}
          }
        }
        queue.push({ work, chatId, resolve, reject });
        drain();
      });
    }

    function snapshot() {
      return Object.freeze({ active, queued: queue.length, activeLimit, queueLimit, lastChatId });
    }

    return Object.freeze({ submit, snapshot });
  }

  return Object.freeze({ createVisibleTranslationAdmission });
});

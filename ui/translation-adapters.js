/* Telegram Web A翻译适配器：只负责消息DOM识别和译文挂载，API/缓存由宿主公共核心处理。 */
(() => {
  'use strict';
  function installTelegramTranslation(cfg) {
    const config = cfg || { chats: {}, global: {} };
    window.__geekTranslationConfig = config;
    if (!window.__geekTranslationRequest) {
      window.__geekTranslationPending = new Map();
      window.__geekTranslationRequest = function (payload) {
        return new Promise((resolve, reject) => {
          const id = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
          window.__geekTranslationPending.set(id, { payload, resolve, reject });
          console.log('__GEEK_TRANSLATION_REQUEST__:' + id);
          setTimeout(() => {
            const pending = window.__geekTranslationPending.get(id);
            if (pending) { window.__geekTranslationPending.delete(id); pending.reject(new Error('翻译请求超时')); }
          }, 35000);
        });
      };
      window.__geekTakeTranslationRequest = id => {
        const p = window.__geekTranslationPending.get(id);
        return p ? JSON.stringify(p.payload) : null;
      };
      window.__geekResolveTranslation = (id, result, error) => {
        const p = window.__geekTranslationPending.get(id);
        if (!p) return false;
        window.__geekTranslationPending.delete(id);
        if (error) p.reject(new Error(error)); else p.resolve(result);
        return true;
      };
    }
    window.__geekTelegramTranslationGeneration = (window.__geekTelegramTranslationGeneration || 0) + 1;
    const generation = window.__geekTelegramTranslationGeneration;
    window.__geekTelegramTranslationObserver?.disconnect();
    document.querySelectorAll('.geek-translation-result[data-geek-platform="telegram"]').forEach(n => n.remove());
    document.querySelectorAll('[data-geek-telegram-translation-state]').forEach(n => delete n.dataset.geekTelegramTranslationState);

    const settingFor = chatId => {
      const g = window.__geekTranslationConfig.global || {};
      const base = {
        provider: g.source || 'auto', route: g.server || 'default',
        displayTranslation: g.displayTranslation !== false,
        translationMode: g.translationMode || (g.message === false ? 'click' : 'auto'),
        messageFrom: g.messageFrom || 'auto', messageTarget: g.messageTo || 'zh',
        fontSize: g.fontSize || '13', fontColor: g.fontColor || '#667eea', groupAuto: g.group === true
      };
      const local = window.__geekTranslationConfig.chats?.[chatId];
      return local ? { ...base, ...local } : base;
    };
    const chatId = () => {
      const hash = String(location.hash || '').replace(/^#/, '');
      if (hash) return hash.split('?')[0];
      const active = document.querySelector('#LeftColumn .Chat.active, #LeftColumn .Chat.selected, .Chat.active');
      const link = active?.querySelector('a[href]');
      return link ? String(link.getAttribute('href') || '').replace(/^#/, '') : '';
    };
    const messageTextNode = row => row.querySelector('.text-content, .message-text');
    const messageText = node => (node?.innerText || node?.textContent || '').replace(/\u200b/g, '').trim();
    const messageId = row => String(row.id || row.dataset.messageId || row.dataset.mid || row.getAttribute('data-mid') || '').trim();
    const outgoing = row => /out|outgoing|is-outgoing/i.test(String(row.className || '')) || !!row.querySelector('.MessageOutgoingStatus, [class*="outgoing"]');
    const process = async row => {
      if (!(row instanceof Element) || !row.classList.contains('Message')) return;
      if (row.dataset.geekTelegramTranslationState || row.querySelector('.geek-translation-result[data-geek-platform="telegram"]')) return;
      const id = messageId(row) || ('dom-' + Array.from(document.querySelectorAll('.Message')).indexOf(row));
      const cid = chatId(); if (!cid) return;
      const setting = settingFor(cid); if (!setting.displayTranslation) return;
      const textNode = messageTextNode(row);
      if (!textNode) {
        if (!row.dataset.geekTelegramTranslationRetry) {
          row.dataset.geekTelegramTranslationRetry = '1';
          setTimeout(() => { delete row.dataset.geekTelegramTranslationRetry; delete row.dataset.geekTelegramTranslationState; process(row); }, 500);
        }
        return;
      }
      const text = messageText(textNode); if (!text) return;
      window.__geekTelegramLastSource = { className: String(textNode.className || ''), text: text.slice(0, 300) };
      row.dataset.geekTelegramTranslationState = 'queued';
      const box = document.createElement('div');
      box.className = 'geek-translation-result'; box.dataset.geekPlatform = 'telegram'; box.dataset.messageId = id;
      box.style.cssText = `padding-top:3px;color:${setting.fontColor};font-size:${setting.fontSize}px;line-height:1.35;white-space:pre-wrap;`;
      textNode.insertAdjacentElement('afterend', box);
      const run = async () => {
        const current = window.__geekTelegramTranslationGeneration;
        row.dataset.geekTelegramTranslationState = 'loading'; box.textContent = '翻译中…';
        try {
          const result = await window.__geekTranslationRequest({ text, source: setting.messageFrom || 'auto', target: setting.messageTarget || 'zh', provider: setting.provider, route: setting.route, chatId: cid, messageId: id });
          if (current !== window.__geekTelegramTranslationGeneration || !settingFor(cid).displayTranslation) { box.remove(); delete row.dataset.geekTelegramTranslationState; return; }
          if (!result?.text) throw new Error('翻译失败');
          box.textContent = result.text; row.dataset.geekTelegramTranslationState = 'done';
        } catch (e) {
          if (current !== window.__geekTelegramTranslationGeneration) return;
          box.textContent = '翻译失败，点击重试'; box.style.color = '#ff8a8a'; box.style.cursor = 'pointer'; row.dataset.geekTelegramTranslationState = 'error';
          box.onclick = () => { delete row.dataset.geekTelegramTranslationState; box.remove(); process(row); };
        }
      };
      if (setting.translationMode === 'click') { box.textContent = '点击翻译'; box.style.cursor = 'pointer'; row.dataset.geekTelegramTranslationState = 'wait'; box.onclick = run; }
      else await run();
    };
    const root = document.querySelector('#MiddleColumn') || document.querySelector('#Main') || document.body;
    window.__geekTelegramTranslationObserver = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.classList?.contains('Message')) process(node);
        node.querySelectorAll?.('.Message').forEach(process);
      }
    });
    window.__geekTelegramTranslationObserver.observe(root, { childList: true, subtree: true });
    root.querySelectorAll?.('.Message').forEach(process);
    return 'TELEGRAM_TRANSLATION_READY';
  }
  window.GeekTranslationAdapters = window.GeekTranslationAdapters || {};
  window.GeekTranslationAdapters.telegram = installTelegramTranslation;
})();

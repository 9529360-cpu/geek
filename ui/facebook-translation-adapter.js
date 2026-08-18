/* Facebook / Messenger 翻译适配器：DOM 识别、译文挂载与发送前翻译。 */
(() => {
  'use strict';

  function installFacebookTranslation(cfg) {
    const rawConfig = cfg || { chats: {}, global: {} };
    const bridgeToken = String(rawConfig.bridgeToken || '');
    const config = {
      accountId: String(rawConfig.accountId || ''),
      chats: rawConfig.chats || {},
      global: rawConfig.global || {},
    };

    window.__geekTranslationConfig = config;
    window.__geekTranslationBridgeToken = bridgeToken;

    if (!window.__geekTranslationRequest) {
      window.__geekTranslationPending = new Map();
      window.__geekTranslationRequest = function (payload) {
        return new Promise((resolve, reject) => {
          const id = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
          const securedPayload = { ...(payload || {}), bridgeToken: window.__geekTranslationBridgeToken };
          window.__geekTranslationPending.set(id, { payload: securedPayload, resolve, reject });
          if (document.documentElement.getAttribute('data-geek-bridge') === '1' || document.getAttribute('data-geek-bridge') === '1') {
            window.postMessage({ __geekBridge: true, payload: { type: 'translation-request', id, token: window.__geekTranslationBridgeToken } }, window.location.origin);
          } else {
            console.log('__GEEK_TRANSLATION_REQUEST__:' + id + ':' + window.__geekTranslationBridgeToken);
          }
          setTimeout(() => {
            const pending = window.__geekTranslationPending.get(id);
            if (pending) {
              window.__geekTranslationPending.delete(id);
              pending.reject(new Error('翻译请求超时'));
            }
          }, 35000);
        });
      };
      window.__geekTakeTranslationRequest = id => {
        const pending = window.__geekTranslationPending.get(id);
        return pending ? JSON.stringify(pending.payload) : null;
      };
      window.__geekResolveTranslation = (id, result, error) => {
        const pending = window.__geekTranslationPending.get(id);
        if (!pending) return false;
        window.__geekTranslationPending.delete(id);
        if (error) pending.reject(new Error(error));
        else pending.resolve(result);
        return true;
      };
    }

    window.__geekNativeInputPending = window.__geekNativeInputPending || new Map();
    window.__geekTakeNativeInputRequest = id => {
      const pending = window.__geekNativeInputPending.get(id);
      return pending ? JSON.stringify({
        accountId: config.accountId,
        bridgeToken: window.__geekTranslationBridgeToken,
        text: pending.text || '',
      }) : null;
    };
    window.__geekResolveNativeInput = (id, ok, error) => {
      const pending = window.__geekNativeInputPending.get(id);
      if (!pending) return false;
      window.__geekNativeInputPending.delete(id);
      if (ok) pending.resolve(true);
      else pending.reject(new Error(error || '原生输入失败'));
      return true;
    };
    const nativeInsertText = text => {
      const id = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
      return new Promise((resolve, reject) => {
        window.__geekNativeInputPending.set(id, { resolve, reject, text: String(text) });
        if (document.documentElement.getAttribute('data-geek-bridge') === '1' || document.getAttribute('data-geek-bridge') === '1') {
          window.postMessage({ __geekBridge: true, payload: { type: 'native-input-request', id, token: window.__geekTranslationBridgeToken } }, window.location.origin);
        } else {
          console.log('__GEEK_NATIVE_INPUT_REQUEST__:' + id + ':' + window.__geekTranslationBridgeToken);
        }
        setTimeout(() => {
          const pending = window.__geekNativeInputPending.get(id);
          if (pending) {
            window.__geekNativeInputPending.delete(id);
            pending.reject(new Error('原生输入请求超时'));
          }
        }, 10000);
      });
    };

    const hostname = String(location.hostname || '').toLowerCase();
    if (!(hostname === 'facebook.com' || hostname.endsWith('.facebook.com') || hostname === 'messenger.com' || hostname.endsWith('.messenger.com'))) {
      return 'FACEBOOK_TRANSLATION_WRONG_PAGE';
    }

    const generation = window.__geekFacebookTranslationGeneration = (window.__geekFacebookTranslationGeneration || 0) + 1;
    let viewEpoch = 0;
    let settleUntil = Date.now() + 2200;
    let lastChatId = '';
    let scanTimer = null;

    window.__geekFacebookTranslationObserver?.disconnect();
    window.__geekFacebookViewAbort?.abort();
    window.__geekFacebookSendAbort?.abort();
    if (window.__geekFacebookChatWatch) clearInterval(window.__geekFacebookChatWatch);
    document.querySelectorAll('.geek-translation-result[data-geek-platform="facebook"]').forEach(node => node.remove());
    document.querySelectorAll('[data-geek-facebook-translation-state]').forEach(node => {
      delete node.dataset.geekFacebookTranslationState;
      delete node.dataset.geekFacebookTranslationKey;
    });

    const normalizeText = value => String(value || '')
      .replace(/[\u200b\u200e\u200f\u2060\ufeff]/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .trim();
    const isChinese = text => /[\u3400-\u9fff]/.test(String(text || ''));
    const hashText = value => {
      const raw = String(value || '');
      let h = 2166136261;
      for (let i = 0; i < raw.length; i++) {
        h ^= raw.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return (h >>> 0).toString(16);
    };
    const isVisible = node => {
      if (!(node instanceof Element) || !node.isConnected) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 1 && rect.height > 1 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };

    // Facebook 的 PIN/一次性代码/安全存储恢复属于 Messenger 自己的阻塞式流程。
    // 这类弹窗存在时，翻译层必须完全静默：不扫描消息、不改 DOM、不拦截发送。
    // 只判断可见模态框的几何特征，不读取、记录或上传 PIN/验证码/聊天内容。
    const hasBlockingDialog = () => {
      const candidates = document.querySelectorAll('[aria-modal="true"],[role="dialog"]');
      for (const node of candidates) {
        if (!(node instanceof Element) || !isVisible(node)) continue;
        const rect = node.getBoundingClientRect();
        const minWidth = Math.min(320, innerWidth * 0.35);
        const minHeight = Math.min(180, innerHeight * 0.20);
        if (rect.width >= minWidth && rect.height >= minHeight) return true;
      }
      return false;
    };

    const currentChatId = () => {
      try {
        const path = decodeURIComponent(String(location.pathname || ''));
        const standard = path.match(/\/messages\/(?:e2ee\/)?t\/([^/?#]+)/i) || path.match(/^\/t\/([^/?#]+)/i);
        if (standard?.[1]) return 'facebook:' + standard[1];
        const query = new URLSearchParams(location.search || '');
        const selected = query.get('selected_item_id') || query.get('thread_id') || query.get('conversation_id');
        if (selected) return 'facebook-business:' + selected;
        const businessPath = path.match(/\/inbox\/(?:all|messenger|instagram|comments)\/([^/?#]+)/i);
        if (businessPath?.[1] && !/^(all|messenger|instagram|comments)$/i.test(businessPath[1])) return 'facebook-business:' + businessPath[1];
      } catch {}
      return '';
    };
    window.__geekFacebookCurrentChatId = currentChatId;

    const settingFor = chatId => {
      const g = window.__geekTranslationConfig.global || {};
      const size = /^\d{1,2}$/.test(String(g.fontSize || '')) ? String(g.fontSize) : '13';
      const color = /^#[0-9a-fA-F]{6}$/.test(String(g.fontColor || '')) ? String(g.fontColor) : '#667eea';
      const base = {
        provider: g.source === 'local' || g.source === 'remote' ? 'auto' : (g.source || 'auto'),
        route: g.server || 'default',
        enabled: g.send === true,
        autoSend: g.send === true,
        source: g.sendFrom || 'auto',
        target: g.sendTo || 'en',
        includeZh: g.includeZh !== false,
        displayTranslation: g.displayTranslation !== false,
        messageAction: g.manual !== false,
        translationMode: g.translationMode || (g.message === false ? 'click' : 'auto'),
        messageFrom: g.messageFrom || 'auto',
        messageTarget: g.messageTo || 'zh',
        translateHistory: g.translateHistory === true || g.transOldHistory === true,
        fontSize: size,
        fontColor: color,
      };
      const local = window.__geekTranslationConfig.chats?.[chatId];
      return local ? { ...base, ...local, source: local.source || base.source, target: local.target || base.target, messageTarget: local.messageTarget || base.messageTarget } : base;
    };

    const composerSelector = [
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"][data-lexical-editor="true"]',
      'textarea[aria-label]',
      'textarea[placeholder]'
    ].join(',');
    const badComposerLabel = /search|搜索|搜尋|buscar|rechercher|cerca|suche|поиск|评论|評論|comment/i;
    const goodComposerLabel = /message|reply|write|send|消息|訊息|回复|回覆|messaggio|mensaje|mensagem|nachricht|сообщ|gönder|kirim|보내|送信/i;
    const findComposer = () => {
      const nodes = [...document.querySelectorAll(composerSelector)].filter(isVisible);
      let best = null;
      let bestScore = -Infinity;
      for (const node of nodes) {
        const label = [node.getAttribute('aria-label'), node.getAttribute('placeholder'), node.getAttribute('data-placeholder')].filter(Boolean).join(' ');
        if (badComposerLabel.test(label)) continue;
        const rect = node.getBoundingClientRect();
        let score = 0;
        if (node.getAttribute('role') === 'textbox') score += 15;
        if (node.hasAttribute('data-lexical-editor')) score += 15;
        if (node.isContentEditable) score += 8;
        if (goodComposerLabel.test(label)) score += 35;
        if (rect.bottom > innerHeight * 0.55) score += 18;
        if (rect.width > 180) score += 8;
        if (node === document.activeElement || node.contains(document.activeElement)) score += 25;
        if (score > bestScore) { best = node; bestScore = score; }
      }
      return best;
    };

    const readComposer = editor => normalizeText(editor?.value !== undefined ? editor.value : editor?.innerText || editor?.textContent || '');
    const selectComposer = editor => {
      if (!editor || !isVisible(editor)) return false;
      editor.focus();
      if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
        editor.select();
        return document.activeElement === editor;
      }
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);
      return document.activeElement === editor || editor.contains(document.activeElement);
    };
    const replaceComposer = async (editor, text) => {
      if (!selectComposer(editor)) throw new Error('Facebook 输入框未获得焦点');
      await nativeInsertText(String(text));
      await new Promise(resolve => setTimeout(resolve, 45));
      return readComposer(editor);
    };

    const buttonLabel = button => normalizeText([
      button?.getAttribute?.('aria-label'),
      button?.getAttribute?.('title'),
      button?.getAttribute?.('data-tooltip-content'),
      button?.textContent,
    ].filter(Boolean).join(' '));
    const sendLabel = /send|发送|發送|envoyer|enviar|invia|senden|отправ|gönder|kirim|보내|送信|ส่ง/i;
    const looksLikeSendButton = button => {
      if (!(button instanceof Element) || !isVisible(button) || button.getAttribute('aria-disabled') === 'true' || button.hasAttribute('disabled')) return false;
      return sendLabel.test(buttonLabel(button));
    };
    const findSendButton = editor => {
      const rect = editor?.getBoundingClientRect?.();
      const buttons = [...document.querySelectorAll('button,[role="button"]')].filter(looksLikeSendButton);
      if (!buttons.length) return null;
      if (!rect) return buttons[0];
      buttons.sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        const ad = Math.abs(ar.left - rect.right) + Math.abs(ar.top - rect.top);
        const bd = Math.abs(br.left - rect.right) + Math.abs(br.top - rect.top);
        return ad - bd;
      });
      return buttons[0];
    };

    window.__geekFacebookOutgoingOriginals = window.__geekFacebookOutgoingOriginals || new Map();
    const rememberOutgoing = (translated, original) => {
      const key = normalizeText(translated);
      if (!key) return;
      const queue = window.__geekFacebookOutgoingOriginals.get(key) || [];
      queue.push({ original: String(original), expiresAt: Date.now() + 120000 });
      window.__geekFacebookOutgoingOriginals.set(key, queue.slice(-8));
    };
    const takeOutgoing = translated => {
      const key = normalizeText(translated);
      const queue = (window.__geekFacebookOutgoingOriginals.get(key) || []).filter(item => item.expiresAt > Date.now());
      const item = queue.shift();
      if (queue.length) window.__geekFacebookOutgoingOriginals.set(key, queue);
      else window.__geekFacebookOutgoingOriginals.delete(key);
      return item?.original || '';
    };

    const statusText = /^(seen|delivered|sent|read|已读|已讀|已发送|已發送|已送达|已送達|送达|送達|\d{1,2}:\d{2}(?:\s*[ap]m)?)$/i;
    const explicitMessageSelector = '[data-testid="message-text"],[data-testid="messenger-message-text"],[data-scope="message_text"]';
    const textNodeScore = node => {
      if (!(node instanceof Element) || !isVisible(node)) return -Infinity;
      if (node.closest('button,[role="button"],a,input,textarea,[contenteditable="true"],nav,[role="navigation"],aside,.geek-translation-result')) return -Infinity;
      const text = normalizeText(node.innerText || node.textContent || '');
      if (!text || text.length > 10000 || statusText.test(text)) return -Infinity;
      let score = node.matches(explicitMessageSelector) ? 100 : 0;
      let current = node;
      for (let depth = 0; depth < 5 && current && current !== document.body; depth++, current = current.parentElement) {
        const style = getComputedStyle(current);
        const bg = String(style.backgroundColor || '');
        const radius = parseFloat(style.borderRadius || '0') || 0;
        if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') score += 7;
        if (radius >= 8) score += 7;
        if (current.getAttribute('role') === 'row' || current.getAttribute('role') === 'article') score += 3;
      }
      if (text.length >= 2) score += 2;
      return score;
    };
    const horizontalMessageOverlap = node => {
      const editor = findComposer();
      if (!editor) return false;
      const er = editor.getBoundingClientRect();
      const nr = node.getBoundingClientRect();
      if (nr.bottom > er.top + 12) return false;
      const overlap = Math.min(nr.right, er.right) - Math.max(nr.left, er.left);
      return overlap > Math.min(nr.width, er.width) * 0.2;
    };
    const messageTextNodes = scope => {
      const root = scope instanceof Element || scope instanceof Document ? scope : document;
      const set = new Set();
      if (root instanceof Element && (root.matches(explicitMessageSelector) || root.matches('[dir="auto"]'))) set.add(root);
      root.querySelectorAll?.(explicitMessageSelector + ',[dir="auto"]').forEach(node => set.add(node));
      const out = [];
      for (const node of set) {
        const text = normalizeText(node.innerText || node.textContent || '');
        if (!text) continue;
        const sameTextChild = [...node.querySelectorAll?.('[dir="auto"]') || []].some(child => child !== node && normalizeText(child.innerText || child.textContent || '') === text);
        if (sameTextChild) continue;
        if (textNodeScore(node) < 8 || !horizontalMessageOverlap(node)) continue;
        out.push(node);
      }
      out.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      return out;
    };
    const messageAnchor = node => {
      const explicit = node.closest('[data-testid="message-container"],[data-testid^="message-"],[role="row"],[role="article"]');
      let best = null;
      let bestScore = -Infinity;
      let current = node;
      for (let depth = 0; depth < 5 && current && current !== document.body; depth++, current = current.parentElement) {
        const rect = current.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 8 || rect.width > innerWidth * 0.92 || rect.height > 600) continue;
        const style = getComputedStyle(current);
        let score = 0;
        const bg = String(style.backgroundColor || '');
        if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') score += 8;
        if ((parseFloat(style.borderRadius || '0') || 0) >= 8) score += 8;
        if (score > bestScore) { best = current; bestScore = score; }
      }
      return bestScore >= 8 ? best : (explicit || node.parentElement || node);
    };
    const isProbablyOutgoing = anchor => {
      const label = normalizeText(anchor?.getAttribute?.('aria-label') || anchor?.closest?.('[aria-label]')?.getAttribute('aria-label') || '');
      if (/you sent|你发送|你發送|vous avez envoyé|hai inviato|enviaste|você enviou|du hast gesendet/i.test(label)) return true;
      const editor = findComposer();
      if (!editor || !(anchor instanceof Element)) return false;
      const er = editor.getBoundingClientRect();
      const ar = anchor.getBoundingClientRect();
      return ar.width < er.width * 0.8 && ar.left > er.left + er.width * 0.42 && ar.right > er.left + er.width * 0.68;
    };
    const clearAnchorState = anchor => {
      anchor.querySelectorAll?.('.geek-translation-result[data-geek-platform="facebook"]').forEach(node => node.remove());
      delete anchor.dataset.geekFacebookTranslationState;
      delete anchor.dataset.geekFacebookTranslationKey;
    };

    const processTextNode = async (node, isHistory = false) => {
      if (!(node instanceof Element) || generation !== window.__geekFacebookTranslationGeneration) return;
      const cid = currentChatId();
      if (!cid) return;
      const setting = settingFor(cid);
      if (!setting.displayTranslation) return;
      if (isHistory && setting.translationMode !== 'click' && setting.translateHistory !== true) return;
      const text = normalizeText(node.innerText || node.textContent || '');
      if (!text) return;
      const anchor = messageAnchor(node);
      if (!(anchor instanceof Element)) return;
      const key = 'fb-' + hashText([cid, text].join('\u001f'));
      if (anchor.dataset.geekFacebookTranslationKey && anchor.dataset.geekFacebookTranslationKey !== key) clearAnchorState(anchor);
      const existing = anchor.querySelector('.geek-translation-result[data-geek-platform="facebook"]');
      if (anchor.dataset.geekFacebookTranslationState && !existing) {
        delete anchor.dataset.geekFacebookTranslationState;
        delete anchor.dataset.geekFacebookTranslationKey;
      }
      if (anchor.dataset.geekFacebookTranslationState || existing) return;

      let original = '';
      if (isProbablyOutgoing(anchor)) original = takeOutgoing(text);
      if (!original && (setting.messageTarget || 'zh') === 'zh' && isChinese(text)) {
        anchor.dataset.geekFacebookTranslationState = 'skip';
        anchor.dataset.geekFacebookTranslationKey = key;
        return;
      }

      anchor.dataset.geekFacebookTranslationState = 'queued';
      anchor.dataset.geekFacebookTranslationKey = key;
      const box = document.createElement('div');
      box.className = 'geek-translation-result';
      box.dataset.geekPlatform = 'facebook';
      box.dataset.messageId = key;
      box.style.cssText = `padding-top:3px;color:${setting.fontColor};font-size:${setting.fontSize}px;line-height:1.35;white-space:pre-wrap;word-break:break-word;`;
      node.insertAdjacentElement('afterend', box);
      const bornEpoch = viewEpoch;

      const run = async refresh => {
        if (anchor.dataset.geekFacebookTranslationState === 'loading') return;
        anchor.dataset.geekFacebookTranslationState = 'loading';
        box.textContent = '翻译中…';
        box.style.cursor = 'default';
        try {
          let translated = original;
          if (!translated) {
            const result = await window.__geekTranslationRequest({
              text,
              source: setting.messageFrom || 'auto',
              target: setting.messageTarget || 'zh',
              provider: setting.provider,
              route: setting.route,
              chatId: cid,
              messageId: key,
              isHistory,
              translateHistory: setting.translateHistory === true || setting.translationMode === 'click',
              refresh: refresh === true,
            });
            if (result?.skipped) {
              box.remove();
              delete anchor.dataset.geekFacebookTranslationState;
              delete anchor.dataset.geekFacebookTranslationKey;
              return;
            }
            if (!result?.text) throw new Error('翻译失败');
            translated = result.text;
          }
          if (generation !== window.__geekFacebookTranslationGeneration || bornEpoch !== viewEpoch || currentChatId() !== cid || !settingFor(cid).displayTranslation) {
            box.remove();
            delete anchor.dataset.geekFacebookTranslationState;
            delete anchor.dataset.geekFacebookTranslationKey;
            return;
          }
          box.textContent = translated;
          box.style.color = setting.fontColor;
          box.style.cursor = 'default';
          anchor.dataset.geekFacebookTranslationState = 'done';
        } catch (error) {
          if (generation !== window.__geekFacebookTranslationGeneration || bornEpoch !== viewEpoch) return;
          if (/额度已用完|QUOTA_EXHAUSTED/.test(String(error?.message || error))) {
            box.remove();
            delete anchor.dataset.geekFacebookTranslationState;
            delete anchor.dataset.geekFacebookTranslationKey;
            return;
          }
          box.textContent = '翻译失败，点击重试';
          box.style.color = '#ff8a8a';
          box.style.cursor = 'pointer';
          anchor.dataset.geekFacebookTranslationState = 'error';
          box.onclick = () => {
            anchor.dataset.geekFacebookTranslationState = 'queued';
            run(true);
          };
        }
      };

      if (setting.translationMode === 'click' && !original) {
        box.textContent = isHistory ? '点击翻译历史消息' : '点击翻译';
        box.style.cursor = 'pointer';
        anchor.dataset.geekFacebookTranslationState = 'wait';
        box.onclick = () => run(false);
      } else {
        await run(false);
      }
    };

    const scan = (scope, mode = 'new') => {
      if (generation !== window.__geekFacebookTranslationGeneration || !currentChatId() || hasBlockingDialog()) return;
      let nodes = messageTextNodes(scope || document);
      if (mode === 'initial' && nodes.length > 12) nodes = nodes.slice(-12);
      const isHistory = mode === 'history';
      nodes.forEach(node => { processTextNode(node, isHistory).catch(() => {}); });
    };
    const scheduleScan = mode => {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(() => scan(document, mode), 120);
    };

    const resetView = chatId => {
      viewEpoch += 1;
      settleUntil = Date.now() + 2200;
      lastChatId = chatId || '';
      document.querySelectorAll('.geek-translation-result[data-geek-platform="facebook"]').forEach(node => node.remove());
      document.querySelectorAll('[data-geek-facebook-translation-state]').forEach(node => {
        delete node.dataset.geekFacebookTranslationState;
        delete node.dataset.geekFacebookTranslationKey;
      });
      if (chatId) {
        scan(document, 'initial');
        setTimeout(() => { if (currentChatId() === chatId) scan(document, 'initial'); }, 900);
        // 稳定期内新增的真实消息可能被 MutationObserver 暂按 history 处理；稳定后补扫一次，避免漏译。
        setTimeout(() => { if (currentChatId() === chatId) scan(document, 'new'); }, 2400);
      }
    };

    window.__geekFacebookTranslationObserver = new MutationObserver(records => {
      // Messenger 恢复加密聊天时 React 会高频重建 DOM。此时只让 Facebook 自己工作，
      // 避免翻译扫描触发布局读取或插入译文，干扰 PIN/一次性代码恢复流程。
      if (hasBlockingDialog()) return;
      const mode = Date.now() < settleUntil ? 'history' : 'new';
      let sawRemoval = false;
      for (const record of records) {
        if (record.removedNodes?.length) sawRemoval = true;
        for (const added of record.addedNodes) {
          if (added.nodeType === 1) scan(added, mode);
        }
      }
      // 模态框关闭本身通常只有 removedNodes；补扫一次当前聊天即可恢复翻译。
      if (sawRemoval) scheduleScan(mode);
    });
    window.__geekFacebookTranslationObserver.observe(document.body, { childList: true, subtree: true });

    window.__geekFacebookViewAbort = new AbortController();
    document.addEventListener('scroll', () => scheduleScan('history'), { capture: true, passive: true, signal: window.__geekFacebookViewAbort.signal });

    lastChatId = currentChatId();
    resetView(lastChatId);
    window.__geekFacebookChatWatch = setInterval(() => {
      const next = currentChatId();
      if (next !== lastChatId) resetView(next);
    }, 700);

    window.__geekFacebookSendAbort = new AbortController();
    window.__geekFacebookSendLock = false;
    const translateAndSend = async (event, editor, button) => {
      if (window.__geekFacebookSendLock || hasBlockingDialog()) return;
      const cid = currentChatId();
      if (!cid) return;
      const setting = settingFor(cid);
      if (!setting.enabled || setting.autoSend === false || !window.__geekTranslationRequest) return;
      const original = readComposer(editor);
      if (!original || (setting.includeZh === false && isChinese(original))) return;

      event?.preventDefault?.();
      event?.stopImmediatePropagation?.();
      window.__geekFacebookSendLock = true;
      try {
        const result = await window.__geekTranslationRequest({
          text: original,
          source: setting.source || 'auto',
          target: setting.target || 'en',
          provider: setting.provider,
          route: setting.route,
          chatId: cid,
        });
        if (!result?.text) throw new Error('翻译失败');
        if (currentChatId() !== cid) throw new Error('聊天已切换，已取消发送');
        if (readComposer(editor) !== original) throw new Error('输入内容已变化，已取消自动翻译');
        rememberOutgoing(result.text, original);
        const actual = await replaceComposer(editor, result.text);
        if (actual !== normalizeText(result.text)) throw new Error('Facebook 编辑器回填校验失败');
        const sendButton = button || findSendButton(editor);
        if (!sendButton) throw new Error('找不到 Facebook 发送按钮');
        await new Promise(resolve => setTimeout(resolve, 35));
        sendButton.click();
      } catch (error) {
        console.error('[geek-facebook-translation-send]', error);
        try {
          const current = readComposer(editor);
          if (current && current !== original) await replaceComposer(editor, original);
        } catch {}
      } finally {
        window.__geekFacebookSendLock = false;
      }
    };

    document.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      const editor = event.target?.closest?.(composerSelector) || (findComposer() === document.activeElement ? document.activeElement : null);
      if (!editor || badComposerLabel.test([editor.getAttribute('aria-label'), editor.getAttribute('placeholder')].filter(Boolean).join(' '))) return;
      translateAndSend(event, editor, findSendButton(editor));
    }, { capture: true, signal: window.__geekFacebookSendAbort.signal });

    document.addEventListener('click', event => {
      const button = event.target?.closest?.('button,[role="button"]');
      if (!button || !looksLikeSendButton(button)) return;
      const editor = findComposer();
      if (!editor) return;
      translateAndSend(event, editor, button);
    }, { capture: true, signal: window.__geekFacebookSendAbort.signal });

    return 'FACEBOOK_TRANSLATION_READY';
  }

  window.GeekTranslationAdapters = window.GeekTranslationAdapters || {};
  window.GeekTranslationAdapters.facebook = installFacebookTranslation;
})();

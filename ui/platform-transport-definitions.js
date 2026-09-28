/* Platform broadcast/transport definitions. Platform extensions register here instead of editing app.js. */
(() => {
  'use strict';

  const BUILTIN_DEFINITIONS = {
    'telegram-z': {
      getChats: `(() => {
        const out = [];
        document.querySelectorAll('.chat-item-clickable').forEach(row => {
          const a = row.querySelector('a');
          if (!a) return;
          const t = row.querySelector('[class*="title"], .peer-title');
          out.push({
            id: (a.getAttribute('href') || '').replace('#', ''),
            name: (t ? t.textContent : '').trim(),
            type: (row.className || '').includes('group') ? '群组' : '联系人'
          });
        });
        return JSON.stringify(out);
      })()`,
      switchChat: (id) => `(() => {
        const a = document.querySelector('.chat-item-clickable a[href="#${id}"]');
        if (!a) return false;
        // React 应用需要完整指针事件序列（普通 click() 无效）
        const fire = (type, opts) => a.dispatchEvent(new PointerEvent(type, Object.assign({bubbles: true, cancelable: true, view: window, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1}, opts)));
        fire('pointerdown');
        a.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 }));
        fire('pointerup', { buttons: 0 });
        a.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 0 }));
        a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, button: 0 }));
        return true;
      })()`,
      setMessage: (msg) => `(async () => {
        // 轮询等 ProseMirror 编辑器就绪（聊天刚打开可能未初始化，大群加载慢）
        let ed = null;
        for (let i = 0; i < 60; i++) {
          ed = document.querySelector('.form-control.ProseMirror') || document.querySelector('[contenteditable="true"]');
          if (ed && ed.textContent !== undefined) break;
          await new Promise(r => setTimeout(r, 250));
        }
        if (!ed) return 'NO_EDITOR';
        // 等编辑器真正可编辑（ProseMirror 初始化完成）
        for (let i = 0; i < 20; i++) {
          ed.focus();
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(ed);
          sel.removeAllRanges();
          sel.addRange(range);
          const ok = document.execCommand('insertText', false, ${JSON.stringify(msg)});
          await new Promise(r => setTimeout(r, 200));
          if ((ed.textContent || '').includes(${JSON.stringify(msg)})) return 'OK';
        }
        return 'EMPTY';
      })()`,
      send: (msg) => `(async () => {
        const modal = document.querySelector('.modal-dialog, .modal-container');
        if (modal) {
          // 文件发送确认弹窗：文字输入到 caption，再点 Send
          const caption = modal.querySelector('[contenteditable="true"], .form-control, textarea, input[type="text"]');
          const m = ${JSON.stringify(msg)};
          if (caption && m) {
            caption.focus();
            document.execCommand('insertText', false, m);
            await new Promise(r => setTimeout(r, 300));
          }
          const modalBtn = [...modal.querySelectorAll('button')].find(b => /primary/.test((b.className || '').toString()));
          if (modalBtn) {
            const fire = (type, opts) => modalBtn.dispatchEvent(new PointerEvent(type, Object.assign({bubbles: true, cancelable: true, view: window, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1}, opts)));
            fire('pointerdown');
            modalBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 }));
            fire('pointerup', { buttons: 0 });
            modalBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 0 }));
            modalBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, button: 0 }));
            return 'CLICKED';
          }
          return 'NO_MODAL_BTN';
        }
        // 普通发送按钮（纯文字）——轮询等按钮就绪（TG 可能延迟出现/短暂禁用）
        let btn = null;
        for (let i = 0; i < 24; i++) {
          btn = document.querySelector('button[class*="send"], button[class*="Send"], button[aria-label*="Send"], .btn-send, button[class*="primary"], .Button.primary');
          if (btn && !btn.disabled) break;
          await new Promise(r => setTimeout(r, 250));
        }
        if (btn) {
          btn.click();
          return 'CLICKED';
        }
        // 无按钮：Enter 发送文字
        const ed = document.querySelector('.form-control.ProseMirror') || document.querySelector('[contenteditable="true"]');
        if (!ed) return 'NO_EDITOR';
        ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        ed.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        // 等编辑器清空（= 发送成功），最长 15 秒
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 250));
          if (!(ed.textContent || '').trim()) return 'SENT';
        }
        return 'MAYBE';
      })()`,
    },
    whatsapp: {
      // WPP 直发模式（对齐原版/HelloWorld：内部 API，不走 UI 模拟）
      // window.WPP（WA-JS 4.6 主路径）+ window.WAPLUS_WPP（HelloWorld fork，仅作兼容回退）
      getChats: `(async () => {
        try {
          const W = window.__geekPickWpp?.(['chat.list']);
          const chats = await W.chat.list();
          const arr = Array.isArray(chats) ? chats : (chats ? Object.values(chats) : []);
          const out = arr.map(c => ({
            id: String(c.id),
            name: (c.name || c.formattedTitle || String(c.id)).trim(),
            realName: (!c.isGroup && c.contact ? (c.contact.pushname || c.contact.name || c.contact.shortName || '') : ''),
            type: c.isGroup ? '群组' : '联系人'
          })).filter(c => c.id.includes('@'));
          return JSON.stringify(out);
        } catch (e) { return 'ERR:' + e.message; }
      })()`,
      sendDirect: (chatId, msg, tagall) => `(async () => {
        try {
          const W = window.__geekPickWpp?.(['chat.sendTextMessage']);
          const extra = {};
          if (${!!tagall}) {
            try {
              const chat = W.whatsapp.ChatStore.get(${JSON.stringify(chatId)});
              if (chat && chat.isGroup && chat.participants) {
                extra.mentionedList = chat.participants.map(p => p.id);
              }
            } catch (e) { /* 拿不到成员则普通发送 */ }
          }
          const r = await Promise.race([
            W.chat.sendTextMessage(${JSON.stringify(chatId)}, ${JSON.stringify(msg)}, extra),
            new Promise(res => setTimeout(() => res({ id: 'submitted' }), 8000))
          ]);
          return r && r.id ? 'SENT' : 'FAIL';
        } catch (e) { return 'ERR:' + e.message; }
      })()`,
      // 电子名片：使用 WA-JS 4.6 官方 API，避免旧内部 SendAction 返回 Promise 但消息不落地
      sendVcards: (chatId, vcards) => `(async () => {
        try {
          const W = window.__geekPickWpp?.(['chat.sendVCardContactMessage','contact.getPnLidEntry']);
          if (!W.chat || typeof W.chat.sendVCardContactMessage !== 'function') return 'ERR:当前 WPP 不支持电子名片发送';
          const rawContacts = ${JSON.stringify(vcards)};
          const contacts = [];
          for (const v of rawContacts) {
            let id = String(v.id);
            if (id.endsWith('@lid') && W.contact.getPnLidEntry) {
              try { const pair = await W.contact.getPnLidEntry(id); id = String(pair?.phoneNumber?._serialized || pair?.phoneNumber || id); } catch (e) {}
            }
            contacts.push({ id, name: String(v.name || v.realName || id) });
          }
          const result = await Promise.race([
            W.chat.sendVCardContactMessage(${JSON.stringify(chatId)}, contacts),
            new Promise((_, reject) => setTimeout(() => reject(new Error('名片发送超时，无回执')), 8000))
          ]);
          return result && (result.id || result.messageId) ? 'SENT' : 'FAIL:名片发送无消息回执';
        } catch (e) { return 'ERR:' + e.message; }
      })()`,
      // WA 文件+文字一起（底层 API——HelloWorld 同款：ChatStore.get 模型 + prepRawMedia + sendMediaMsgToChat，秒发）
      sendFileDirect: (chatId, file, caption) => `(async () => {
        try {
          const W = window.require;
          const wpp = window.__geekPickWpp?.(['whatsapp.ChatStore']);
          const chatModel = wpp.whatsapp.ChatStore.get(${JSON.stringify(chatId)});
          if (!chatModel) return 'NO_CHAT';
          const bytes = Uint8Array.from(atob('${file.base64}'), c => c.charCodeAt(0));
          const f = new File([bytes], ${JSON.stringify(file.name || 'file')}, { type: ${JSON.stringify(file.mime || 'application/octet-stream')} });
          const mediaData = W('WAWebMediaOpaqueData').createFromData(f, f.type);
          const mime = ${JSON.stringify(file.mime || '')};
          const type = mime.startsWith('image') ? 'image' : mime.startsWith('video') ? 'video' : mime.startsWith('audio') ? 'audio' : 'document';
          const prepOptions = { isPtt: false, asDocument: type === 'document', asGif: false, isAudio: type === 'audio', asSticker: type === 'sticker', precomputedFields: { duration: null, waveform: null } };
          const preparedMedia = W('WAWebMedia').prepRawMedia(mediaData, prepOptions);
          await preparedMedia.waitForPrep();
          const result = await W('WAWebMediaPrep').sendMediaMsgToChat({
            chat: chatModel,
            options: { addEvenWhilePreparing: false, caption: ${JSON.stringify(caption)}, type },
            prep: preparedMedia,
            earlyUpload: null,
          });
          return result ? 'SENT' : 'FAIL';
        } catch (e) { return 'ERR:' + e.message; }
      })()`,
    },
    line: {
      getChats: `(() => {
        const out = [];
        document.querySelectorAll('[class*="chatlistItem-module__chatlist_item__"][data-mid]').forEach(row => {
          const name = row.querySelector('[class*="chatlistItem-module__title_box__"] [class*="chatlistItem-module__text__"], [class*="chatlistItem-module__title_box__"] pre, [class*="chatlistItem-module__title_box__"]');
          out.push({ id: String(row.getAttribute('data-mid') || ''), name: (name?.textContent || '').trim().replace(/\\s*\\(\\d+\\)\\s*$/, ''), type: row.querySelector('[class*="member_count"]') ? '群组' : '联系人' });
        });
        return JSON.stringify(out.filter(item => item.id && item.name));
      })()`,
      switchChat: (id) => `(() => {
        const targetId = ${JSON.stringify(id)};
        const row = [...document.querySelectorAll('[class*="chatlistItem-module__chatlist_item__"][data-mid]')].find(item => String(item.getAttribute('data-mid') || '') === targetId);
        const button = row?.querySelector('[class*="button_chatlist_item"]');
        if (!button) return false; button.click(); return true;
      })()`,
      setMessage: (msg) => `(() => {
        const host = document.querySelector('textarea-ex[class*="chatroomEditor-module__textarea__"]');
        const textarea = host?.shadowRoot?.querySelector('textarea');
        if (!host || !textarea || typeof host.insertValue !== 'function') return 'NO_EDITOR';
        textarea.focus(); document.execCommand('selectAll', false, null); host.insertValue([${JSON.stringify(msg)}]);
        const text = (Array.isArray(host.value) ? host.value : [host.value]).filter(value => typeof value === 'string').join('').trim();
        return text === ${JSON.stringify(msg)}.trim() ? 'OK' : 'EMPTY';
      })()`,
      sendAttachment: (msg, beforeIds) => `(async () => {
        const baselineIds = new Set(${JSON.stringify(beforeIds || [])});
        let fileSent = false;
        for (let i = 0; i < 80; i++) {
          await new Promise(resolve => setTimeout(resolve, 250));
          const modalGone = !document.querySelector('[class*="sendFileModal-module__modal__"]');
          const currentIds = [...document.querySelectorAll('[class*="message-module__message__"][data-mid]')].map(el => el.getAttribute('data-mid')).filter(Boolean);
          const messageAdded = currentIds.some(id => !baselineIds.has(id));
          if (modalGone && messageAdded) { fileSent = true; break; }
        }
        if (!fileSent) return 'FILE_SEND_NOT_CONFIRMED';
        const text = ${JSON.stringify(msg)};
        if (!text.trim()) return 'SENT';
        const host = document.querySelector('textarea-ex[class*="chatroomEditor-module__textarea__"]');
        const textarea = host?.shadowRoot?.querySelector('textarea');
        if (!host || !textarea || typeof host.insertValue !== 'function') return 'NO_EDITOR';
        const textBefore = document.querySelectorAll('[class*="message-module__message__"][data-mid]').length;
        textarea.focus();
        document.execCommand('selectAll', false, null);
        host.insertValue([text]);
        const actual = (Array.isArray(host.value) ? host.value : [host.value]).filter(value => typeof value === 'string').join('').trim();
        if (actual !== text.trim()) return 'TEXT_SET_FAILED';
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true }));
        for (let i = 0; i < 60; i++) {
          await new Promise(resolve => setTimeout(resolve, 250));
          const value = (Array.isArray(host.value) ? host.value : [host.value]).filter(v => typeof v === 'string').join('').trim();
          if (document.querySelectorAll('[class*="message-module__message__"][data-mid]').length > textBefore && !value) return 'SENT';
        }
        return 'TEXT_SEND_NOT_CONFIRMED';
      })()`,
      submitPastedImages: (msg, beforeIds, expectedImages) => `(async () => {
        const expected = Number(${JSON.stringify(expectedImages || 0)});
        if (!Number.isFinite(expected) || expected < 1) return 'INVALID_IMAGE_COUNT';
        const pastedSelector = '[class*="pastedImageList-module__image_list_item__"]';
        const pastedBeforeSubmit = document.querySelectorAll(pastedSelector).length;
        if (pastedBeforeSubmit < expected) return 'LINE_PASTED_IMAGE_NOT_READY';
        const text = ${JSON.stringify(msg)};
        const host = document.querySelector('textarea-ex[class*="chatroomEditor-module__textarea__"]');
        const textarea = host?.shadowRoot?.querySelector('textarea');
        if (!host || !textarea || typeof host.insertValue !== 'function') return 'NO_EDITOR';
        if (text.trim()) {
          textarea.focus();
          document.execCommand('selectAll', false, null);
          host.insertValue([text]);
          let textStableChecks = 0;
          for (let i = 0; i < 20; i++) {
            await new Promise(resolve => setTimeout(resolve, 50));
            const actual = (Array.isArray(host.value) ? host.value : [host.value])
              .filter(value => typeof value === 'string')
              .join('')
              .trim();
            if (actual === text.trim()) textStableChecks += 1;
            else textStableChecks = 0;
            if (textStableChecks >= 3) break;
          }
          if (textStableChecks < 3) return 'TEXT_STATE_NOT_READY';
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }
        textarea.focus();
        textarea.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          altKey: true, metaKey: true, bubbles: true, cancelable: true, composed: true
        }));
        let pastedCleared = false;
        let textCleared = !text.trim();
        for (let i = 0; i < 80; i++) {
          await new Promise(resolve => setTimeout(resolve, 250));
          const pastedCount = document.querySelectorAll(pastedSelector).length;
          pastedCleared = pastedCount === 0;
          if (!textCleared) {
            const currentText = (Array.isArray(host.value) ? host.value : [host.value])
              .filter(value => typeof value === 'string')
              .join('')
              .trim();
            textCleared = currentText.length === 0;
          }
          if (pastedCleared && textCleared) return 'SENT';
        }
        return pastedCleared ? 'LINE_TEXT_NOT_CLEARED' : 'LINE_SUBMIT_NOT_OBSERVED';
      })()`,
      send: `(async () => {
        const host = document.querySelector('textarea-ex[class*="chatroomEditor-module__textarea__"]');
        const textarea = host?.shadowRoot?.querySelector('textarea');
        if (!host || !textarea) return 'NO_EDITOR';
        const before = (Array.isArray(host.value) ? host.value : [host.value]).filter(v => typeof v === 'string').join('').trim();
        if (!before) return 'EMPTY';
        const editorArea = host.closest?.('[class*="chatroomEditor-module__editor_area__"]') || document.querySelector('[class*="chatroomEditor-module__editor_area__"]');
        const submitButton = editorArea?.querySelector('button[aria-label*="send" i],button[type="submit"],button[data-action="send"]');
        if (!submitButton) return 'NO_SEND_BUTTON';
        const count = document.querySelectorAll('[class*="message-module__message__"][data-mid]').length;
        submitButton.click();
        for (let i = 0; i < 40; i++) { await new Promise(resolve => setTimeout(resolve, 250)); const value = (Array.isArray(host.value) ? host.value : [host.value]).filter(v => typeof v === 'string').join('').trim(); if (document.querySelectorAll('[class*="message-module__message__"][data-mid]').length > count && !value) return 'SENT'; }
        return 'MAYBE';
      })()`,
    },
  };

  const BUILTIN_FAMILY_KEYS = Object.freeze({
    telegram: 'telegram-z',
    whatsapp: 'whatsapp',
    line: 'line',
  });
  const extensionDefinitions = new Map();
  const extensionFamilyKeys = new Map();

  function normalizeKey(value, label) {
    const key = String(value || '').trim();
    if (!key) throw new TypeError(label + ' is required');
    return key;
  }

  function register(key, definition, options = {}) {
    const definitionKey = normalizeKey(key, 'platform transport key');
    if (!definition || typeof definition !== 'object') {
      throw new TypeError('platform transport definition is required');
    }
    if (Object.prototype.hasOwnProperty.call(BUILTIN_DEFINITIONS, definitionKey)
      || extensionDefinitions.has(definitionKey)) {
      throw new Error('platform transport already registered: ' + definitionKey);
    }
    const family = normalizeKey(options.family || definitionKey, 'platform transport family');
    if (Object.prototype.hasOwnProperty.call(BUILTIN_FAMILY_KEYS, family)
      || extensionFamilyKeys.has(family)) {
      throw new Error('platform transport family already registered: ' + family);
    }
    extensionDefinitions.set(definitionKey, definition);
    extensionFamilyKeys.set(family, definitionKey);
  }

  function create() {
    const definitions = new Map(Object.entries(BUILTIN_DEFINITIONS));
    const familyKeys = new Map(Object.entries(BUILTIN_FAMILY_KEYS));
    for (const [key, definition] of extensionDefinitions) definitions.set(key, definition);
    for (const [family, key] of extensionFamilyKeys) familyKeys.set(family, key);

    function registerRuntime(key, definition, options = {}) {
      const definitionKey = normalizeKey(key, 'platform transport key');
      if (!definition || typeof definition !== 'object') throw new TypeError('platform transport definition is required');
      if (definitions.has(definitionKey)) throw new Error('platform transport already registered: ' + definitionKey);
      const family = normalizeKey(options.family || definitionKey, 'platform transport family');
      if (familyKeys.has(family)) throw new Error('platform transport family already registered: ' + family);
      definitions.set(definitionKey, definition);
      familyKeys.set(family, definitionKey);
    }

    function definitionFor({ family } = {}) {
      const familyKey = String(family || '').trim();
      if (!familyKey) return null;
      const definitionKey = familyKeys.get(familyKey) || familyKey;
      return definitions.get(definitionKey) || null;
    }

    return Object.freeze({
      definitionFor,
      hasFamily: family => familyKeys.has(String(family || '').trim()) || definitions.has(String(family || '').trim()),
      hasKey: key => definitions.has(String(key || '').trim()),
      families: () => Object.freeze(Array.from(familyKeys.keys())),
      keys: () => Object.freeze(Array.from(definitions.keys())),
      register: registerRuntime,
    });
  }

  window.GeekPlatformTransportDefinitions = Object.freeze({
    create,
    register,
  });
})();

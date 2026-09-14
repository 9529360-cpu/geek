(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastRuntime = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const draftFilesByAccount = new Map();
  const materializedFilesByJob = new Map();
  let installed = false;
  let executor = null;
  let scheduler = null;
  let editorAccountId = '';
  let historyAppender = null;

  function activeAccountId() {
    return document.querySelector('.nav-account.active[data-id]')?.dataset.id || '';
  }

  async function listAccounts() {
    const listed = await window.api.accounts.list();
    return listed?.accounts || listed || [];
  }

  function webviewForAccount(account) {
    if (!account) return null;
    return [...document.querySelectorAll('webview')].find(wv =>
      String(wv.partition || wv.getAttribute?.('partition') || '') === String(account.partition || '')
    ) || null;
  }

  async function contextForAccount(accountId) {
    const accounts = await listAccounts();
    const account = accounts.find(item => String(item.id) === String(accountId));
    if (!account) throw new Error('账号不存在或已移除');
    const wv = webviewForAccount(account);
    if (!wv) throw new Error('账号页面尚未就绪');
    const factory = window.GeekPlatformTransports?.forAccount;
    if (typeof factory !== 'function') throw new Error('群发传输尚未就绪');
    const platform = factory(account, wv);
    return { account, wv, platform, adapter: platform.transport };
  }

  function liveGuestId(ctx) {
    if (!ctx?.wv || typeof ctx.wv.getWebContentsId !== 'function') return null;
    const id = Number(ctx.wv.getWebContentsId());
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  function currentDraftFiles(accountId = activeAccountId()) {
    const id = String(accountId || '');
    if (!draftFilesByAccount.has(id)) draftFilesByAccount.set(id, []);
    return draftFilesByAccount.get(id);
  }

  function resetDraftFiles(accountId = activeAccountId()) {
    const id = String(accountId || '');
    if (!id) return;
    draftFilesByAccount.set(id, []);
  }

  function renderDraftFiles(accountId = activeAccountId()) {
    const el = document.getElementById('broadcast-files');
    if (!el) return;
    el.replaceChildren();
    currentDraftFiles(accountId).forEach((file, index) => {
      const item = document.createElement('span');
      item.className = 'bf-item';
      item.title = String(file.name || '附件');
      item.append(document.createTextNode(String(file.name || '附件') + ' '));
      const remove = document.createElement('i');
      remove.dataset.runtimeFileIndex = String(index);
      remove.textContent = '×';
      item.appendChild(remove);
      el.appendChild(item);
    });
  }

  async function pickDraftFiles(accountId = activeAccountId()) {
    if (!accountId) return;
    const zone = document.getElementById('broadcast-dropzone');
    if (zone) zone.style.display = 'flex';
    const picked = await window.api.file.pick({ multiple: true });
    if (!picked) return;
    const next = currentDraftFiles(accountId);
    const incoming = Array.isArray(picked) ? picked : [picked];
    for (const file of incoming) {
      if (next.length >= 10) break;
      next.push(Object.freeze({ ...file }));
    }
    renderDraftFiles(accountId);
  }

  function selectedChatIds() {
    return [...document.querySelectorAll('#bc-selected-chips .bc-selected-chip button[data-id]')]
      .map(button => String(button.dataset.id || ''))
      .filter(Boolean);
  }

  function selectedTargets() {
    const read = window.__broadcastSelectedTargets;
    if (typeof read !== 'function') return [];
    const targets = read();
    return Array.isArray(targets) ? targets.filter(target => String(target?.id || '').trim()) : [];
  }

  function dedupeTargets(targets) {
    const seen = new Set();
    const unique = [];
    for (const target of Array.isArray(targets) ? targets : []) {
      const id = String(target?.id || '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      unique.push(target);
    }
    return unique;
  }

  function validateContent(message, files, vcards) {
    return !!String(message || '').trim() || !!files?.length || !!vcards?.length;
  }

  function createHistoryAppender(options = {}) {
    const getAll = options.getAll;
    const set = options.set;
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    if (typeof getAll !== 'function' || typeof set !== 'function') throw new TypeError('broadcast history appender requires getAll/set');
    const tails = new Map();

    function append(job) {
      const accountId = String(job?.accountId || '');
      if (!accountId) return Promise.reject(new TypeError('broadcast history requires accountId'));
      const previous = tails.get(accountId) || Promise.resolve();
      const run = previous.catch(() => {}).then(async () => {
        const data = await getAll(accountId);
        let history;
        try { history = JSON.parse(data?.sendHistory || '[]'); } catch (_) { history = []; }
        if (!Array.isArray(history)) history = [];
        const fileCount = job.attachmentRefs?.length || job.files.length;
        history.push({ t: now(), total: job.total, ok: job.ok, fail: job.fail, files: fileCount, msgLen: job.message.length, jobId: job.id });
        if (history.length > 500) history.splice(0, history.length - 500);
        await set(accountId, 'sendHistory', JSON.stringify(history));
        return true;
      });
      let tracked;
      tracked = run.finally(() => {
        if (tails.get(accountId) === tracked) tails.delete(accountId);
      });
      tails.set(accountId, tracked);
      return tracked;
    }

    return Object.freeze({ append, pendingAccounts: () => [...tails.keys()] });
  }

  function getHistoryAppender() {
    if (!historyAppender) {
      historyAppender = createHistoryAppender({
        getAll: accountId => window.api.accountData.getAll(accountId),
        set: (accountId, key, value) => window.api.accountData.set(accountId, key, value),
      });
    }
    return historyAppender;
  }

  function shouldFailContextInitialization(job) {
    return !!job && !['scheduled', 'queued'].includes(String(job.state || ''));
  }

  function resetTransientDraftGlobals() {
    window.__excelNumbers = [];
    window.__vcardContacts = [];
  }

  async function resolveGroupMembers(ctx) {
    const sel = document.getElementById('bc-group-members-select');
    const groupIds = sel ? [...sel.selectedOptions].map(option => option.value).filter(Boolean) : [];
    if (!groupIds.length) throw new Error('请先选择至少一个群组');
    if (!(ctx.account.type === 'whatsapp' || ctx.account.type === 'whatsapp-pure')) throw new Error('群成员私聊发送仅支持 WhatsApp');
    const result = await ctx.wv.executeJavaScript(`(async () => {
      try {
        const W = window.__geekPickWpp?.(['whatsapp.UserPrefs','group.getParticipants','contact.get','contact.getPnLidEntry']);
        const UP = W.whatsapp.UserPrefs;
        const mePn = UP.getMaybeMePnUser ? UP.getMaybeMePnUser() : UP.getMeUser();
        const meLid = UP.getMaybeMeLidUser ? UP.getMaybeMeLidUser() : null;
        const mine = [mePn, meLid].filter(Boolean).map(x => String(x._serialized || x));
        const seen = new Set();
        const out = [];
        for (const gid of ${JSON.stringify(groupIds)}) {
          const parts = await W.group.getParticipants(gid);
          for (const p of parts) {
            let id = String(p.id && (p.id._serialized || p.id) || p);
            if (mine.includes(id) || seen.has(id)) continue;
            try {
              if (id.endsWith('@lid') && W.contact.getPnLidEntry) {
                const pair = await W.contact.getPnLidEntry(id);
                const phoneNumber = pair?.phoneNumber || pair?.pn;
                if (phoneNumber) id = String(phoneNumber._serialized || phoneNumber);
              }
            } catch (_) {}
            seen.add(id);
            const c = await W.contact.get(id).catch(() => null);
            out.push({ id, name: c ? (c.name || c.pushname || c.shortName || id) : id, realName: c ? (c.pushname || c.name || '') : '' });
          }
        }
        return JSON.stringify(out);
      } catch (e) { return 'ERR:' + e.message; }
    })()`);
    const text = String(result || '');
    if (text.startsWith('ERR:')) throw new Error('读取群成员失败: ' + text.slice(4));
    return JSON.parse(text || '[]');
  }

  async function resolveLabelTargets(ctx, chats) {
    const labelId = document.getElementById('bc-label-select')?.value;
    if (!labelId) throw new Error('请先选择标签');
    const result = await ctx.wv.executeJavaScript(`(async () => {
      try {
        const L = window.require('WAWebLabelCollection').LabelCollection;
        const lb = (L._models || []).find(l => String(l.id) === ${JSON.stringify(labelId)});
        const ids = lb && (lb.__x_chatIds || (lb.getChatIds ? lb.getChatIds() : [])) || [];
        return JSON.stringify(ids.map(c => String(c)));
      } catch (e) { return 'ERR:' + e.message; }
    })()`);
    const text = String(result || '');
    if (text.startsWith('ERR:')) throw new Error('获取标签联系人失败: ' + text.slice(4));
    const ids = JSON.parse(text || '[]');
    return chats.filter(chat => ids.includes(chat.id));
  }

  async function resolveNumberTargets(ctx, chats, mode) {
    const numbers = mode === 'paste'
      ? (document.getElementById('bc-paste-numbers')?.value || '').split(/\n+/).map(value => value.trim()).filter(Boolean)
      : (window.__excelNumbers || []).map(value => String(value).trim()).filter(Boolean);
    let targets = numbers.map(number => {
      const clean = number.replace(/\s+/g, '');
      const hit = chats.find(chat => (chat.name || '').includes(clean) || String(chat.id).includes(clean));
      return hit || { id: clean, name: clean, isNumber: true };
    });
    if (!(ctx.account.type === 'whatsapp' || ctx.account.type === 'whatsapp-pure') || !targets.length) return targets;
    const result = await ctx.wv.executeJavaScript(`(async () => {
      try {
        const W = window.__geekPickWpp?.(['contact.queryExists']);
        const out = [];
        for (const n of ${JSON.stringify(targets.map(target => target.id))}) {
          const raw = String(n).replace(/[^0-9@]/g, '');
          const jid = raw.includes('@') ? raw : raw + '@c.us';
          const c = await W.contact.queryExists(jid);
          if (c) out.push({ id: String(c.wid || c.id || jid), name: String(c.pushname || c.name || jid), isNumber: true });
        }
        return JSON.stringify(out);
      } catch (e) { return 'ERR:' + e.message; }
    })()`);
    const text = String(result || '');
    if (text.startsWith('ERR:')) throw new Error('号码核验失败: ' + text.slice(4));
    return JSON.parse(text || '[]');
  }

  async function resolveTargets(ctx) {
    const mode = document.querySelector('input[name="bc-sendto"]:checked')?.value || 'custom';
    const excluded = window.__broadcastExcludeSet ? window.__broadcastExcludeSet() : new Set();
    let targets;
    if (mode === 'custom') {
      targets = selectedTargets();
    } else {
      const chats = await ctx.platform.listChats();
      if (mode === 'group-members') targets = await resolveGroupMembers(ctx);
      else if (mode === 'label') targets = await resolveLabelTargets(ctx, chats);
      else if (mode === 'paste' || mode === 'excel') targets = await resolveNumberTargets(ctx, chats, mode);
      else if (['all', 'all-contacts', 'all-groups', 'exclude-contacts', 'exclude-groups'].includes(mode)) {
        const model = window.GeekBroadcastUiModel;
        if (!model || typeof model.resolveAudience !== 'function') throw new Error('群发受众解析组件尚未就绪');
        targets = model.resolveAudience({ mode, chats, selectedIds: selectedChatIds(), excludedIds: excluded });
      } else {
        const ids = new Set(selectedChatIds());
        targets = chats.filter(chat => ids.has(String(chat.id)));
      }
    }
    targets = dedupeTargets(targets);
    if (excluded.size) targets = targets.filter(target => !excluded.has(target.id));
    if (!targets.length) throw new Error('请先选择要发送的聊天');
    return targets;
  }

  function greeting() {
    const hour = new Date().getHours();
    return hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
  }

  function personalize(message, target) {
    const expanded = String(message || '').replace(/\{([^{}|]+(?:\|[^{}|]+)+)\}/g, (_all, body) => {
      const choices = body.split('|');
      return choices[Math.floor(Math.random() * choices.length)].trim();
    });
    return expanded
      .replace(/%nc/gi, target.name || '')
      .replace(/%nr/gi, target.realName || target.name || '')
      .replace(/%sa/gi, greeting());
  }

  function executionFiles(job) {
    return materializedFilesByJob.get(String(job?.id || '')) || job?.files || [];
  }

  function scheduledAttachmentApi() {
    const api = window.api?.broadcastScheduled;
    if (!api || typeof api.persist !== 'function' || typeof api.materialize !== 'function' || typeof api.cleanup !== 'function') {
      throw new Error('定时附件持久化能力尚未就绪');
    }
    return api;
  }

  async function materializeScheduledAttachments(job) {
    const refs = Array.isArray(job?.attachmentRefs) ? job.attachmentRefs : [];
    if (!refs.length) return executionFiles(job);
    const files = await scheduledAttachmentApi().materialize({
      accountId: job.accountId,
      taskId: job.id,
      refs: refs.map(item => String(item?.ref || item || '')),
    });
    if (!Array.isArray(files) || files.length !== refs.length) throw new Error('定时附件恢复失败，请重新选择附件');
    const mapped = files.map(file => Object.freeze({
      name: String(file?.name || '附件'),
      size: Number(file?.size) || 0,
      mime: String(file?.mime || 'application/octet-stream'),
      filePath: String(file?.token || ''),
    }));
    if (mapped.some(file => !file.filePath)) throw new Error('定时附件恢复失败，请重新选择附件');
    materializedFilesByJob.set(String(job.id), Object.freeze(mapped));
    return mapped;
  }

  async function cleanupScheduledAttachments(job) {
    if (!job?.id || !job?.accountId || !job.attachmentRefs?.length) return false;
    try {
      await scheduledAttachmentApi().cleanup({ accountId: job.accountId, taskId: job.id });
      return true;
    } catch (_) {
      return false;
    }
  }

  async function sendTarget(ctx, job, target) {
    const message = personalize(job.message, target);
    const adapter = ctx.adapter;
    const files = executionFiles(job);
    const vcards = Array.isArray(job.vcards) ? job.vcards : [];
    const guestId = liveGuestId(ctx);
    let sent = 'NO_SEND';
    let composer = 'NO_SET';
    if (adapter.sendDirect) {
      const delivery = window.GeekBroadcastDelivery;
      if (!delivery || typeof delivery.sendDirectBundle !== 'function') return { ok: false, reason: '群发附件发送组件尚未就绪' };
      return delivery.sendDirectBundle({
        files,
        message,
        vcards,
        sendFile: ({ file, caption }) => window.api.broadcast.sendFile({
          partition: job.partition,
          filePath: file.filePath,
          chatId: target.id,
          caption,
          mime: file.mime,
          name: file.name,
        }),
        sendText: () => ctx.wv.executeJavaScript(adapter.sendDirect(target.id, message, job.tagAll)),
        sendVcards: typeof adapter.sendVcards === 'function'
          ? cards => ctx.wv.executeJavaScript(adapter.sendVcards(target.id, cards))
          : null,
      });
    }

    if (files.length) {
      try {
        const opened = await ctx.platform.openChat(target.id);
        await new Promise(resolve => setTimeout(resolve, 900));
        const currentChatId = await ctx.platform.getCurrentChat();
        const openGuard = window.GeekBroadcastSafety.authorizeSend({ opened, currentChatId, targetChatId: target.id, composerResult: 'NO_SET', needsComposer: false });
        if (!openGuard.ok) return { ok: false, reason: `ERR:${openGuard.reason}` };
        if (ctx.platform.family === 'telegram') {
          sent = await window.api.broadcast.sendTelegramAttachments({ partition: job.partition, guestId, targetChatId: target.id, caption: message, files });
          return sent === 'SENT' || sent === 'CLICKED' ? { ok: true } : { ok: false, reason: String(sent || 'TG_NATIVE_ATTACH_FAILED') };
        }
        for (const file of files) {
          const dropped = await window.api.broadcast.dropFile({ partition: job.partition, filePath: file.filePath, mime: file.mime, platform: ctx.platform.family, guestId: ctx.platform.family === 'line' ? guestId : undefined });
          if (dropped !== true) return { ok: false, reason: typeof dropped === 'string' ? dropped : 'ERR:文件未进入发送面板' };
          await new Promise(resolve => setTimeout(resolve, ctx.platform.family === 'line' ? 500 : 3000));
        }
        if (ctx.platform.family === 'line') {
          if (typeof adapter.submitPastedImages !== 'function') return { ok: false, reason: 'ERR:LINE粘贴图片发送适配器缺失' };
          const readyRaw = await ctx.wv.executeJavaScript(`(() => JSON.stringify({ pastedCount: document.querySelectorAll('[class*="pastedImageList-module__image_list_item__"]').length, ids: [...document.querySelectorAll('[class*="message-module__message__"][data-mid]')].map(el => el.getAttribute('data-mid')).filter(Boolean) }))()`);
          let readyState = {};
          try { readyState = JSON.parse(readyRaw || '{}'); } catch (_) {}
          if (Number(readyState.pastedCount || 0) < files.length) return { ok: false, reason: 'LINE_PASTED_IMAGE_NOT_READY' };
          sent = await ctx.wv.executeJavaScript(adapter.submitPastedImages(message, Array.isArray(readyState.ids) ? readyState.ids : [], files.length));
        } else {
          sent = await ctx.wv.executeJavaScript(adapter.send(message));
        }
        return sent === 'SENT' || sent === 'CLICKED' ? { ok: true } : { ok: false, reason: String(sent || 'ATTACHMENT_SEND_FAILED') };
      } catch (error) {
        return { ok: false, reason: `ERR:${String(error?.message || error || 'ATTACHMENT_SEND_EXCEPTION')}` };
      }
    }

    if (!message.trim()) return { ok: false, reason: vcards.length ? 'ERR:名片:VCARD_TRANSPORT_UNAVAILABLE' : 'NO_CONTENT' };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const opened = await ctx.platform.openChat(target.id);
        await new Promise(resolve => setTimeout(resolve, 900));
        const currentChatId = await ctx.platform.getCurrentChat();
        const openGuard = window.GeekBroadcastSafety.authorizeSend({ opened, currentChatId, targetChatId: target.id, composerResult: 'NO_SET', needsComposer: false });
        if (!openGuard.ok) { sent = `ERR:${openGuard.reason}`; continue; }
          composer = await ctx.platform.setComposerText(message);
          const finalChatId = await ctx.platform.getCurrentChat();
          const actualText = await ctx.platform.getComposerText();
          const composerGuard = window.GeekBroadcastSafety.authorizeSend({ opened, currentChatId: finalChatId, targetChatId: target.id, composerResult: composer, needsComposer: true, expectedComposerText: message, actualComposerText: actualText });
          if (!composerGuard.ok) {
            await ctx.platform.clearComposerText().catch(() => false);
            sent = `ERR:${composerGuard.reason}`;
            continue;
          }
          sent = await ctx.platform.sendText('');
        if (sent === 'SENT' || sent === 'CLICKED') return { ok: true };
      } catch (error) {
        sent = `ERR:${String(error?.message || error)}`;
      }
    }
    return { ok: false, reason: `${sent} set=${composer}` };
  }

  async function appendHistory(job) {
    try {
      await getHistoryAppender().append(job);
    } catch (_) {}
  }

  async function runJob(jobId) {
    const manager = window.GeekBroadcastJobs;
    const job = manager.get(jobId);
    if (!job) return null;
    let ctx;
    try {
      ctx = await contextForAccount(job.accountId);
    } catch (error) {
      const current = manager.get(job.id);
      if (shouldFailContextInitialization(current)) manager.markFailed(job.id, error);
      throw error;
    }
    try {
      await materializeScheduledAttachments(job);
    } catch (error) {
      const current = manager.get(job.id);
      if (current && !['completed', 'stopped', 'failed'].includes(current.state)) manager.markFailed(job.id, error);
      await cleanupScheduledAttachments(job);
      materializedFilesByJob.delete(String(job.id));
      throw error;
    }
    return executor.run(jobId, {
      sendTarget: (currentJob, target) => sendTarget(ctx, currentJob, target),
      finished: async finalJob => {
        await appendHistory(finalJob);
        await cleanupScheduledAttachments(finalJob);
        materializedFilesByJob.delete(String(finalJob.id));
      },
      failed: async finalJob => {
        await cleanupScheduledAttachments(finalJob);
        materializedFilesByJob.delete(String(finalJob?.id || job.id));
      },
    });
  }

  async function runPendingWithRecovery(job) {
    if (!job) return null;
    const persistence = window.GeekBroadcastSchedulePersistenceInstance;
    if (persistence && typeof persistence.startDueForAccount === 'function') {
      return persistence.startDueForAccount(job.accountId);
    }
    try {
      return await runJob(job.id);
    } catch (error) {
      const manager = window.GeekBroadcastJobs;
      const current = manager?.get(job.id);
      if (current && ['scheduled', 'queued'].includes(current.state)) manager.markFailed(job.id, error);
      throw error;
    }
  }

  async function onScheduledDue(task) {
    const manager = window.GeekBroadcastJobs;
    const job = manager.get(task.jobId);
    if (!job || ['completed', 'stopped', 'failed'].includes(job.state)) return;
    if (manager.hasActive(job.accountId)) {
      if (job.state === 'scheduled') manager.transition(job.id, 'queued');
      return;
    }
    try { await runPendingWithRecovery(job); }
    catch (_) {}
  }

  async function drainQueued(accountId) {
    const manager = window.GeekBroadcastJobs;
    if (manager.hasActive(accountId)) return;
    const next = manager.getPending(accountId).find(job => job.state === 'queued' || (job.state === 'scheduled' && job.scheduledAt != null && job.scheduledAt <= Date.now()));
    if (!next) return;
    try { await runPendingWithRecovery(next); } catch (_) {}
  }

  function nextScheduledJobId() {
    return `bc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function startFromEditor() {
    const accountId = activeAccountId();
    if (!accountId) throw new Error('请先选择账号');
    if (editorAccountId && editorAccountId !== accountId) throw new Error('群发编辑期间账号已切换，请重新打开群发窗口确认发送账号');
    if (!editorAccountId) editorAccountId = accountId;
    const manager = window.GeekBroadcastJobs;
    const scheduleToggle = document.getElementById('broadcast-schedule-toggle')?.checked;
    const scheduleValue = document.getElementById('broadcast-schedule-time')?.value;
    const scheduledAt = scheduleToggle && scheduleValue ? new Date(scheduleValue).getTime() : null;
    const isFuture = Number.isFinite(scheduledAt) && scheduledAt > Date.now();
    if (!isFuture && manager.hasActive(accountId)) throw new Error('当前账号已有群发任务，请先查看或停止当前任务');

    const ctx = await contextForAccount(accountId);
    const files = currentDraftFiles(accountId).map(file => ({ ...file }));
    const message = document.getElementById('broadcast-message')?.value || '';
    const vcards = Array.isArray(window.__vcardContacts) ? window.__vcardContacts.map(card => ({ ...card })) : [];
    if (!validateContent(message, files, vcards)) throw new Error('请输入消息内容、添加附件或选择电子名片');
    const targets = await resolveTargets(ctx);
    const intervalMin = Math.max(5, Number(document.getElementById('broadcast-interval-min')?.value) || 5);
    const intervalMax = Math.max(intervalMin, Number(document.getElementById('broadcast-interval-max')?.value) || Math.max(10, intervalMin));
    const scheduledJobId = isFuture ? nextScheduledJobId() : null;
    let attachmentRefs = [];
    if (isFuture && files.length) {
      attachmentRefs = await scheduledAttachmentApi().persist({
        accountId,
        taskId: scheduledJobId,
        fileTokens: files.map(file => String(file.filePath || '')),
      });
      if (!Array.isArray(attachmentRefs) || attachmentRefs.length !== files.length || attachmentRefs.some(item => !item?.ref)) {
        await scheduledAttachmentApi().cleanup({ accountId, taskId: scheduledJobId }).catch(() => false);
        throw new Error('定时附件持久化失败，请重新选择附件');
      }
    }

    const seed = {
      id: scheduledJobId || undefined,
      accountId,
      accountName: ctx.account.name || '',
      partition: ctx.account.partition || '',
      platformFamily: ctx.platform.family || '',
      webviewId: String(ctx.wv.id || ''),
      guestId: typeof ctx.wv.getWebContentsId === 'function' ? ctx.wv.getWebContentsId() : null,
      targets,
      message,
      files: isFuture ? [] : files,
      attachmentRefs,
      vcards,
      tagAll: !!document.getElementById('broadcast-tagall')?.checked,
      intervalMin,
      intervalMax,
      scheduledAt: isFuture ? scheduledAt : null,
    };

    let job;
    if (isFuture) {
      try {
        job = manager.register({ ...seed, state: 'scheduled' });
        scheduler.schedule({ id: `timer-${job.id}`, accountId, scheduledAt, jobId: job.id, targets: job.targets, message: job.message, intervalMin, intervalMax, tagAll: job.tagAll }, onScheduledDue);
      } catch (error) {
        if (attachmentRefs.length) await scheduledAttachmentApi().cleanup({ accountId, taskId: scheduledJobId }).catch(() => false);
        const current = manager.get(scheduledJobId);
        if (current && !['completed', 'stopped', 'failed'].includes(current.state)) manager.markFailed(current.id, error);
        throw error;
      }
    } else {
      job = manager.start(seed);
    }
    resetDraftFiles(accountId);
    resetTransientDraftGlobals();
    editorAccountId = '';
    document.getElementById('broadcast-overlay')?.classList.add('hidden');
    if (!isFuture) void runJob(job.id).catch(() => {});
    return job;
  }

  function install() {
    if (installed || typeof document === 'undefined') return;
    const manager = window.GeekBroadcastJobs;
    if (!manager || !window.GeekBroadcastExecutor || !window.GeekBroadcastScheduleRegistry) return;
    installed = true;
    window.__geekBroadcastRuntimeOwnsSend = true;
    executor = window.GeekBroadcastExecutor.createExecutor({ manager });
    scheduler = window.GeekBroadcastScheduleRegistry.createRegistry();

    manager.subscribe(event => {
      if (!event?.job || !['completed', 'stopped', 'failed'].includes(event.job.state)) return;
      queueMicrotask(() => {
        void cleanupScheduledAttachments(event.job);
        materializedFilesByJob.delete(String(event.job.id || ''));
        void drainQueued(event.job.accountId);
      });
    });

    document.addEventListener('change', event => {
      const input = event.target?.closest?.('#broadcast-add-file');
      if (!input || !input.checked) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const accountId = activeAccountId();
      void pickDraftFiles(accountId).catch(() => {}).finally(() => { input.checked = false; });
    }, true);

    document.addEventListener('click', event => {
      const remove = event.target?.closest?.('[data-runtime-file-index]');
      if (remove) {
        event.preventDefault(); event.stopImmediatePropagation();
        const files = currentDraftFiles();
        files.splice(Number(remove.dataset.runtimeFileIndex), 1);
        renderDraftFiles();
        return;
      }
      const dropzone = event.target?.closest?.('#broadcast-dropzone');
      if (dropzone) {
        event.preventDefault(); event.stopImmediatePropagation();
        void pickDraftFiles().catch(() => {});
        return;
      }
      const send = event.target?.closest?.('#broadcast-send');
      if (send) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (send.dataset.runtimePending === '1') return;
        send.dataset.runtimePending = '1';
        send.disabled = true;
        void startFromEditor().catch(error => alert(String(error?.message || error))).finally(() => {
          send.dataset.runtimePending = '';
          send.disabled = false;
        });
        return;
      }
      const open = event.target?.closest?.('#bc-menu-send');
      if (open) {
        const accountId = activeAccountId();
        if (!window.GeekBroadcastJobs?.hasActive(accountId)) {
          resetDraftFiles(accountId);
          resetTransientDraftGlobals();
          editorAccountId = accountId;
        }
        setTimeout(() => renderDraftFiles(accountId), 0);
      }
    }, true);

    window.GeekBroadcastRuntimeInstance = Object.freeze({
      startFromEditor,
      runJob,
      renderDraftFiles,
      filesFor: accountId => currentDraftFiles(accountId).map(file => ({ ...file })),
      scheduler,
      executor,
    });
  }

  return Object.freeze({ install, activeAccountId, personalize, dedupeTargets, validateContent, createHistoryAppender, shouldFailContextInitialization, liveGuestId, selectedTargets });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastRuntime.install(), { once: true });
  else window.GeekBroadcastRuntime.install();
}
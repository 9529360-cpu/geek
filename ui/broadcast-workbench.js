(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastWorkbench = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const TERMINAL = new Set(['completed', 'stopped', 'failed']);
  const STEP_IDS = Object.freeze(['content', 'audience', 'settings', 'review']);
  let installed = false;
  let currentStep = 'content';
  let toastTimer = null;
  let bypassNextOpen = false;

  function activeAccountId() {
    return document.querySelector('.nav-account.active[data-id]')?.dataset.id || '';
  }

  function jobStatusLabel(job) {
    const labels = { starting: '准备中', running: '发送中', paused: '已暂停', stopping: '停止中', scheduled: '已定时', queued: '排队中', completed: '已完成', stopped: '已停止', failed: '有异常' };
    return job ? (labels[job.state] || String(job.state || '')) : '';
  }

  function formatDateTime(value) {
    const time = Number(value);
    if (!Number.isFinite(time) || time <= 0) return '立即发送';
    try { return new Date(time).toLocaleString(); } catch (_) { return '定时发送'; }
  }

  function stepForCard(card) {
    if (!card) return '';
    if (card.classList.contains('bc-compose-card')) return 'content';
    if (card.classList.contains('bc-recipient-card')) return 'audience';
    if (card.classList.contains('bc-schedule-card') || card.classList.contains('bc-interval-card')) return 'settings';
    if (card.classList.contains('bc-review-card')) return 'review';
    return '';
  }

  function injectStyles() {
    if (document.getElementById('broadcast-workbench-style')) return;
    const style = document.createElement('style');
    style.id = 'broadcast-workbench-style';
    style.textContent = `
      #broadcast-overlay .bc-dialog{width:min(760px,calc(100vw - 28px));border-radius:14px;box-shadow:0 24px 72px rgba(0,0,0,.38)}
      #broadcast-overlay .bc-header{min-height:52px;padding:0 16px;background:color-mix(in srgb,var(--bg-surface) 96%,transparent)}
      #broadcast-overlay .bc-header__heading small{display:block;margin-top:2px;color:var(--text-tertiary)}
      .bc-workbench-nav{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:10px 12px 8px;border-bottom:1px solid var(--border-standard);background:var(--bg-elevated)}
      .bc-workbench-step{display:flex;align-items:center;gap:7px;min-width:0;padding:8px 9px;border:1px solid transparent;border-radius:9px;background:transparent;color:var(--text-tertiary);cursor:pointer;text-align:left;transition:.18s ease}
      .bc-workbench-step:hover{background:var(--bg-hover);color:var(--text-primary)}
      .bc-workbench-step[data-active="true"]{border-color:color-mix(in srgb,var(--accent) 38%,var(--border-standard));background:var(--accent-soft);color:var(--accent);transform:translateY(-1px)}
      .bc-workbench-step b{display:grid;place-items:center;width:22px;height:22px;border-radius:999px;background:var(--bg-elevated);font-size:10.5px;border:1px solid var(--border-standard)}
      .bc-workbench-step span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;font-weight:650}
      #broadcast-overlay .bc-body{padding:12px;gap:10px;max-height:calc(100vh - 184px);background:color-mix(in srgb,var(--bg-elevated) 94%,var(--bg-surface))}
      #broadcast-overlay .bc-card{border-radius:10px;padding:12px;border-color:var(--border-standard)}
      #broadcast-overlay .bc-card[data-workbench-hidden="true"]{display:none!important}
      .bc-review-card{display:flex;flex-direction:column;gap:10px}.bc-review-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
      .bc-review-item,.bc-review-preview{padding:10px;border:1px solid var(--border-standard);border-radius:9px;background:var(--bg-elevated)}
      .bc-review-item small,.bc-review-preview small{display:block;color:var(--text-tertiary);font-size:10.5px;margin-bottom:4px}.bc-review-item strong{font-size:12px;word-break:break-word}.bc-review-preview p{margin:0;white-space:pre-wrap;max-height:110px;overflow:auto;font-size:11.5px;line-height:1.55}
      .bc-workbench-footer-tools{display:flex;align-items:center;gap:6px;margin-right:auto}.bc-workbench-footer-tools button{height:32px;padding:0 11px;border:1px solid var(--border-standard);border-radius:8px;background:var(--bg-elevated);color:var(--text-secondary);cursor:pointer}.bc-workbench-footer-tools button:hover{background:var(--bg-hover);color:var(--text-primary)}
      #broadcast-overlay .bc-footer{padding:10px 12px;background:color-mix(in srgb,var(--bg-surface) 96%,transparent);border-top:1px solid var(--border-standard)}
      .bc-workbench-status{display:flex;align-items:center;gap:8px;min-height:32px;padding:7px 10px;border-radius:8px;background:var(--bg-elevated);border:1px solid var(--border-standard);font-size:11px;color:var(--text-secondary)}
      .bc-workbench-status i{width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px var(--accent-soft)}.bc-workbench-status[data-state="loading"] i{animation:bc-workbench-pulse 1s ease-in-out infinite}
      @keyframes bc-workbench-pulse{0%,100%{opacity:.35;transform:scale(.82)}50%{opacity:1;transform:scale(1.15)}}
      .bc-workbench-toast{position:fixed;right:18px;bottom:20px;z-index:240;min-width:260px;max-width:390px;padding:11px 12px;border:1px solid var(--border-standard);border-radius:10px;background:color-mix(in srgb,var(--bg-surface) 96%,transparent);box-shadow:0 18px 50px rgba(0,0,0,.34);backdrop-filter:blur(16px);color:var(--text-primary);font-size:11.5px;display:flex;align-items:center;gap:9px;animation:bc-toast-in .18s ease-out}.bc-workbench-toast button{margin-left:auto;border:0;border-radius:7px;padding:5px 8px;background:var(--accent-soft);color:var(--accent);cursor:pointer}
      @keyframes bc-toast-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
      .bc-task-center-button{margin-left:8px;height:28px;padding:0 9px;border:1px solid var(--border-standard);border-radius:7px;background:var(--bg-elevated);color:var(--text-secondary);font-size:10.5px;cursor:pointer}.bc-task-center-button:hover{background:var(--bg-hover);color:var(--text-primary)}
      .bc-task-center-overlay{position:fixed;inset:0;z-index:250;background:rgba(0,0,0,.38);display:grid;place-items:center;backdrop-filter:blur(3px)}.bc-task-center-overlay.hidden{display:none}.bc-task-center{width:min(650px,calc(100vw - 32px));max-height:min(680px,calc(100vh - 40px));overflow:hidden;border:1px solid var(--border-standard);border-radius:14px;background:var(--bg-surface);box-shadow:0 24px 80px rgba(0,0,0,.42);display:flex;flex-direction:column}
      .bc-task-center-head{display:flex;align-items:center;padding:13px 15px;border-bottom:1px solid var(--border-standard)}.bc-task-center-head strong{font-size:14px}.bc-task-center-head small{margin-left:8px;color:var(--text-tertiary)}.bc-task-center-head button{margin-left:auto;border:0;background:transparent;color:var(--text-tertiary);font-size:20px;cursor:pointer}.bc-task-center-body{overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
      .bc-task-row{padding:10px 11px;border:1px solid var(--border-standard);border-radius:9px;background:var(--bg-elevated)}.bc-task-row-head{display:flex;align-items:center;gap:8px}.bc-task-row-head strong{font-size:12px}.bc-task-state{padding:2px 6px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-size:9.5px}.bc-task-row-meta{margin-top:5px;color:var(--text-tertiary);font-size:10.5px}.bc-task-actions{display:flex;gap:6px;margin-top:8px}.bc-task-actions button{height:26px;padding:0 8px;border:1px solid var(--border-standard);border-radius:6px;background:var(--bg-surface);color:var(--text-secondary);font-size:10.5px;cursor:pointer}.bc-task-history-title{margin:7px 2px 0;color:var(--text-secondary);font-size:11px;font-weight:700}.bc-task-empty{padding:26px 12px;text-align:center;color:var(--text-tertiary);font-size:11.5px}
      @media (max-width:640px){.bc-workbench-nav{grid-template-columns:repeat(2,1fr)}.bc-review-grid{grid-template-columns:1fr}}
      @media (prefers-reduced-motion:reduce){.bc-workbench-step,.bc-workbench-toast,.bc-workbench-status i{transition:none!important;animation:none!important}}
    `;
    document.head.appendChild(style);
  }

  function showToast(message, actionText, onAction, persist = false) {
    let toast = document.getElementById('broadcast-workbench-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'broadcast-workbench-toast';
      toast.className = 'bc-workbench-toast';
      toast.setAttribute('role', 'status');
      document.body.appendChild(toast);
    }
    toast.replaceChildren(document.createTextNode(String(message || '')));
    if (actionText && typeof onAction === 'function') {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = actionText;
      button.onclick = () => { toast.remove(); onAction(); };
      toast.appendChild(button);
    }
    clearTimeout(toastTimer);
    if (!persist) toastTimer = setTimeout(() => toast.remove(), 3600);
    return toast;
  }

  async function listAccounts() {
    const listed = await window.api.accounts.list();
    return listed?.accounts || listed || [];
  }

  function webviewForAccount(account) {
    return account ? [...document.querySelectorAll('webview')].find(wv => String(wv.partition || wv.getAttribute?.('partition') || '') === String(account.partition || '')) || null : null;
  }

  async function probeWhatsAppReadiness(account) {
    const wv = webviewForAccount(account);
    if (!wv || typeof wv.executeJavaScript !== 'function') return { ready: false, reason: '账号页面正在创建' };
    try {
      const raw = await wv.executeJavaScript(`(async()=>{try{const W=window.WAPLUS_WPP||window.WPP;if(!W||!W.chat||typeof W.chat.list!=='function')return JSON.stringify({ready:false,stage:'bridge'});await W.chat.list();return JSON.stringify({ready:true});}catch(e){return JSON.stringify({ready:false,stage:'sync'});}})()`);
      const state = JSON.parse(String(raw || '{}'));
      return state.ready ? { ready: true } : { ready: false, reason: state.stage === 'sync' ? '正在同步聊天数据' : '正在加载群发组件' };
    } catch (_) { return { ready: false, reason: '正在加载群发组件' }; }
  }

  async function awaitBroadcastReadiness(account, options = {}) {
    if (!account) return { ready: false, reason: '请先选择账号' };
    if (!String(account.type || '').startsWith('whatsapp')) return { ready: true };
    const attempts = Math.max(1, Number(options.attempts) || 18);
    const intervalMs = Math.max(120, Number(options.intervalMs) || 450);
    for (let attempt = 0; attempt < attempts; attempt++) {
      const state = await probeWhatsAppReadiness(account);
      if (state.ready) return state;
      options.onProgress?.({ ...state, attempt, attempts });
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return { ready: false, reason: 'WhatsApp 群发组件仍在初始化' };
  }

  function ensureInlineStatus() {
    const meta = document.getElementById('broadcast-meta');
    if (!meta) return null;
    let status = document.getElementById('broadcast-workbench-status');
    if (!status) {
      status = document.createElement('div'); status.id = 'broadcast-workbench-status'; status.className = 'bc-workbench-status'; status.innerHTML = '<i></i><span>联系人与群组准备就绪后会自动显示</span>';
      meta.parentElement?.insertBefore(status, meta);
    }
    return status;
  }

  function setInlineStatus(text, state = 'ready') {
    const status = ensureInlineStatus();
    if (!status) return;
    status.dataset.state = state;
    const span = status.querySelector('span');
    if (span) span.textContent = text;
  }

  function selectedAudienceCount() {
    const mode = document.querySelector('input[name="bc-sendto"]:checked')?.value || 'custom';
    if (mode === 'custom') return document.querySelectorAll('#bc-selected-chips .bc-selected-chip').length;
    if (mode === 'paste') return Number(document.getElementById('bc-paste-total')?.textContent) || 0;
    if (mode === 'excel') return Number((document.getElementById('bc-excel-meta')?.textContent || '').match(/(\d+)/)?.[1]) || 0;
    if (mode === 'group-members') return document.getElementById('bc-group-members-select')?.selectedOptions?.length || 0;
    if (mode === 'label') return document.getElementById('bc-label-select')?.value ? 1 : 0;
    return Number(window.__geekBroadcastAudienceEstimate?.()) || 0;
  }

  function ensureReviewCard() {
    const body = document.querySelector('#broadcast-overlay .bc-body');
    if (!body) return null;
    let card = document.getElementById('broadcast-review-card');
    if (card) return card;
    card = document.createElement('section'); card.id = 'broadcast-review-card'; card.className = 'bc-card bc-review-card';
    card.innerHTML = `<h3 class="bc-card-title"><span>检查发送</span><small>确认发送账号、对象、内容和时间</small></h3><div class="bc-review-grid"><div class="bc-review-item"><small>发送账号</small><strong data-review="account">—</strong></div><div class="bc-review-item"><small>发送对象</small><strong data-review="audience">—</strong></div><div class="bc-review-item"><small>发送时间</small><strong data-review="time">—</strong></div><div class="bc-review-item"><small>发送间隔</small><strong data-review="interval">—</strong></div><div class="bc-review-item"><small>附件 / 名片</small><strong data-review="extras">—</strong></div><div class="bc-review-item"><small>任务方式</small><strong data-review="mode">固定受众快照</strong></div></div><div class="bc-review-preview"><small>消息预览</small><p data-review="message">未填写文本消息</p></div>`;
    body.appendChild(card);
    return card;
  }

  async function refreshReview() {
    const card = ensureReviewCard();
    if (!card) return;
    const accountId = activeAccountId();
    const accounts = await listAccounts().catch(() => []);
    const account = accounts.find(item => String(item.id) === String(accountId));
    const count = selectedAudienceCount();
    const scheduleOn = document.getElementById('broadcast-schedule-toggle')?.checked === true;
    const rawTime = document.getElementById('broadcast-schedule-time')?.value || '';
    const scheduledAt = scheduleOn && rawTime ? new Date(rawTime).getTime() : NaN;
    const lo = Number(document.getElementById('broadcast-interval-min')?.value) || 5;
    const hi = Math.max(lo, Number(document.getElementById('broadcast-interval-max')?.value) || 10);
    const files = document.querySelectorAll('#broadcast-files .bf-item').length;
    const vcards = Array.isArray(window.__vcardContacts) ? window.__vcardContacts.length : 0;
    const text = String(document.getElementById('broadcast-message')?.value || '').trim();
    const platform = String(account?.type || '').replace('whatsapp-pure', 'WhatsApp').replace('whatsapp', 'WhatsApp').replace('telegram-z', 'Telegram').replace('telegram-k', 'Telegram').replace('line-business', 'LINE').replace('line', 'LINE');
    const values = { account: account ? `${account.name || '当前账号'} · ${platform}` : '当前账号', audience: count ? `${count} 个对象` : '尚未选择对象', time: Number.isFinite(scheduledAt) && scheduledAt > Date.now() ? formatDateTime(scheduledAt) : '立即发送', interval: `${lo}–${hi} 秒 · 随机等待`, extras: `${files} 个附件 · ${vcards} 张名片`, message: text ? text.slice(0, 320) : (files || vcards ? '无文本，仅发送附件或名片' : '未填写文本消息') };
    for (const [key, value] of Object.entries(values)) {
      const node = card.querySelector(`[data-review="${key}"]`); if (node) node.textContent = value;
    }
  }

  function setStep(step) {
    if (!STEP_IDS.includes(step)) return;
    currentStep = step;
    document.querySelectorAll('#broadcast-overlay .bc-card').forEach(card => {
      const own = stepForCard(card); if (own) card.dataset.workbenchHidden = own === step ? 'false' : 'true';
    });
    document.querySelectorAll('.bc-workbench-step').forEach(button => { button.dataset.active = button.dataset.step === step ? 'true' : 'false'; });
    const send = document.getElementById('broadcast-send'); const next = document.getElementById('broadcast-workbench-next'); const prev = document.getElementById('broadcast-workbench-prev');
    if (send) send.style.display = step === 'review' ? '' : 'none';
    if (next) next.style.display = step === 'review' ? 'none' : '';
    if (prev) prev.disabled = step === STEP_IDS[0];
    if (step === 'review') void refreshReview();
    document.querySelector('#broadcast-overlay .bc-body')?.scrollTo?.({ top: 0, behavior: 'smooth' });
  }

  function ensureStepper() {
    const header = document.querySelector('#broadcast-overlay .bc-header');
    if (!header || document.getElementById('broadcast-workbench-nav')) return;
    const nav = document.createElement('nav'); nav.id = 'broadcast-workbench-nav'; nav.className = 'bc-workbench-nav'; nav.setAttribute('aria-label', '群发创建步骤');
    [['content', '1', '消息内容'], ['audience', '2', '发送对象'], ['settings', '3', '发送设置'], ['review', '4', '检查发送']].forEach(([id, num, label]) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'bc-workbench-step'; button.dataset.step = id; button.innerHTML = `<b>${num}</b><span>${label}</span>`; button.onclick = () => setStep(id); nav.appendChild(button);
    });
    header.insertAdjacentElement('afterend', nav);
  }

  function ensureFooterNavigation() {
    const footer = document.querySelector('#broadcast-overlay .bc-footer__btns');
    if (!footer || document.getElementById('broadcast-workbench-next')) return;
    const tools = document.createElement('div'); tools.className = 'bc-workbench-footer-tools';
    const prev = document.createElement('button'); prev.id = 'broadcast-workbench-prev'; prev.type = 'button'; prev.textContent = '上一步';
    const next = document.createElement('button'); next.id = 'broadcast-workbench-next'; next.type = 'button'; next.textContent = '下一步';
    prev.onclick = () => setStep(STEP_IDS[Math.max(0, STEP_IDS.indexOf(currentStep) - 1)]);
    next.onclick = () => setStep(STEP_IDS[Math.min(STEP_IDS.length - 1, STEP_IDS.indexOf(currentStep) + 1)]);
    tools.append(prev, next); footer.insertBefore(tools, footer.firstChild);
  }

  function resetWorkbenchOnOpen() {
    ensureStepper(); ensureFooterNavigation(); ensureReviewCard(); setStep('content');
    setInlineStatus('正在读取当前账号的联系人与群组…', 'loading');
  }

  function ensureTaskCenter() {
    let overlay = document.getElementById('broadcast-task-center-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div'); overlay.id = 'broadcast-task-center-overlay'; overlay.className = 'bc-task-center-overlay hidden';
    overlay.innerHTML = `<section class="bc-task-center" role="dialog" aria-modal="true" aria-label="群发任务中心"><header class="bc-task-center-head"><strong>群发任务</strong><small>当前账号</small><button type="button" aria-label="关闭">×</button></header><div class="bc-task-center-body"></div></section>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.bc-task-center-head button').onclick = () => overlay.classList.add('hidden');
    overlay.onclick = event => { if (event.target === overlay) overlay.classList.add('hidden'); };
    return overlay;
  }

  function jobRow(job, manager) {
    const row = document.createElement('article'); row.className = 'bc-task-row';
    const total = Number(job.total) || 0; const current = Number(job.current) || 0;
    row.innerHTML = `<div class="bc-task-row-head"><strong>${jobStatusLabel(job)}</strong><span class="bc-task-state">${job.state}</span></div><div class="bc-task-row-meta">${current}/${total} · 成功 ${Number(job.ok) || 0} · 失败 ${Number(job.fail) || 0}${job.scheduledAt ? ` · ${formatDateTime(job.scheduledAt)}` : ''}</div>`;
    if (!TERMINAL.has(job.state)) {
      const actions = document.createElement('div'); actions.className = 'bc-task-actions';
      if (job.state === 'running' || job.state === 'paused') {
        const pause = document.createElement('button'); pause.type = 'button'; pause.textContent = job.state === 'paused' ? '继续' : '暂停'; pause.onclick = async () => { await manager.invoke(job.id, job.state === 'paused' ? 'resume' : 'pause').catch(() => {}); void renderTaskCenter(); }; actions.appendChild(pause);
      }
      const stop = document.createElement('button'); stop.type = 'button'; stop.textContent = job.state === 'scheduled' ? '取消定时' : job.state === 'queued' ? '取消排队' : '停止后续发送'; stop.onclick = async () => { await manager.invoke(job.id, 'stop').catch(() => {}); void renderTaskCenter(); }; actions.appendChild(stop); row.appendChild(actions);
    }
    return row;
  }

  async function renderTaskCenter() {
    const overlay = ensureTaskCenter(); const body = overlay.querySelector('.bc-task-center-body'); const manager = window.GeekBroadcastJobs; const accountId = activeAccountId();
    if (!body || !manager || !accountId) return;
    body.replaceChildren();
    const jobs = manager.list(accountId).slice().reverse();
    if (jobs.length) jobs.forEach(job => body.appendChild(jobRow(job, manager)));
    else { const empty = document.createElement('div'); empty.className = 'bc-task-empty'; empty.textContent = '当前账号还没有本次会话的群发任务'; body.appendChild(empty); }
    let history = [];
    try { const data = await window.api.accountData.getAll(accountId); const parsed = JSON.parse(data?.sendHistory || '[]'); if (Array.isArray(parsed)) history = parsed.slice(-8).reverse(); } catch (_) {}
    if (history.length) {
      const title = document.createElement('div'); title.className = 'bc-task-history-title'; title.textContent = '最近发送记录'; body.appendChild(title);
      history.forEach(item => { const row = document.createElement('article'); row.className = 'bc-task-row'; row.innerHTML = `<div class="bc-task-row-head"><strong>发送记录</strong><span class="bc-task-state">历史</span></div><div class="bc-task-row-meta">${formatDateTime(item.t)} · 共 ${Number(item.total) || 0} · 成功 ${Number(item.ok) || 0} · 失败 ${Number(item.fail) || 0} · 附件 ${Number(item.files) || 0}</div>`; body.appendChild(row); });
    }
  }

  function openTaskCenter() { const overlay = ensureTaskCenter(); overlay.classList.remove('hidden'); void renderTaskCenter(); }

  function ensureTaskButton() {
    const trigger = document.getElementById('btn-broadcast');
    if (!trigger || document.getElementById('broadcast-task-center-button')) return;
    const button = document.createElement('button'); button.id = 'broadcast-task-center-button'; button.type = 'button'; button.className = 'bc-task-center-button'; button.textContent = '任务'; button.title = '查看当前账号群发任务'; button.onclick = event => { event.stopPropagation(); openTaskCenter(); }; trigger.insertAdjacentElement('afterend', button);
  }

  async function prepareAndReopen(open) {
    const accountId = activeAccountId();
    const accounts = await listAccounts().catch(() => []);
    const account = accounts.find(item => String(item.id) === String(accountId));
    if (!account) { showToast('请先选择一个账号'); return; }
    if (String(account.type || '').startsWith('whatsapp')) {
      showToast('正在准备 WhatsApp 群发联系人…', '', null, true);
      const readiness = await awaitBroadcastReadiness(account, { onProgress: state => showToast(state.reason || '正在准备 WhatsApp 群发联系人…', '', null, true) });
      document.getElementById('broadcast-workbench-toast')?.remove();
      if (!readiness.ready) { showToast('WhatsApp 群发组件仍在初始化，可直接重试。', '重试', () => open.click(), true); return; }
    }
    bypassNextOpen = true;
    open.click();
    queueMicrotask(() => { resetWorkbenchOnOpen(); });
  }

  function onDocumentClick(event) {
    const open = event.target?.closest?.('#bc-menu-send');
    if (!open) return;
    if (bypassNextOpen) { bypassNextOpen = false; return; }
    // This boundary must be synchronous. If we await account/WPP state before stopping
    // propagation, legacy app.js can open the editor before readiness is known.
    event.preventDefault();
    event.stopImmediatePropagation();
    void prepareAndReopen(open);
  }

  function install() {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    injectStyles(); ensureStepper(); ensureFooterNavigation(); ensureReviewCard(); ensureTaskButton(); ensureTaskCenter(); setStep('content');
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('input', () => { if (currentStep === 'review') void refreshReview(); }, true);
    document.addEventListener('change', () => { if (currentStep === 'review') void refreshReview(); }, true);
    const overlay = document.getElementById('broadcast-overlay');
    if (overlay) {
      const observer = new MutationObserver(() => {
        if (overlay.classList.contains('hidden')) return;
        ensureStepper(); ensureFooterNavigation(); ensureReviewCard();
        const text = String(document.getElementById('broadcast-meta')?.textContent || '');
        if (/^共\s*\d+\s*个聊天/.test(text)) setInlineStatus('联系人与群组已就绪', 'ready');
        else if (/加载|读取/.test(text)) setInlineStatus('正在同步联系人与群组…', 'loading');
      });
      observer.observe(overlay, { attributes: true, attributeFilter: ['class'], subtree: true, childList: true, characterData: true });
    }
    window.GeekBroadcastJobs?.subscribe?.(() => { if (!document.getElementById('broadcast-task-center-overlay')?.classList.contains('hidden')) void renderTaskCenter(); });
  }

  return Object.freeze({ install, jobStatusLabel, formatDateTime, stepForCard, awaitBroadcastReadiness });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastWorkbench.install(), { once: true });
  else window.GeekBroadcastWorkbench.install();
}

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
  let overlayWasOpen = false;

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
      .bc-workbench-status i{width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px var(--accent-soft)}.bc-workbench-status[data-state="loading"] i{animation:bc-workbench-pulse 1s ease-in-out infinite}.bc-workbench-status[data-state="error"] i{background:#d97706;box-shadow:0 0 0 4px color-mix(in srgb,#d97706 18%,transparent)}
      @keyframes bc-workbench-pulse{0%,100%{opacity:.35;transform:scale(.82)}50%{opacity:1;transform:scale(1.15)}}
      .bc-task-center-button{margin-left:8px;height:28px;padding:0 9px;border:1px solid var(--border-standard);border-radius:7px;background:var(--bg-elevated);color:var(--text-secondary);font-size:10.5px;cursor:pointer}.bc-task-center-button:hover{background:var(--bg-hover);color:var(--text-primary)}
      .bc-task-center-overlay{position:fixed;inset:0;z-index:250;background:rgba(0,0,0,.38);display:grid;place-items:center;backdrop-filter:blur(3px)}.bc-task-center-overlay.hidden{display:none}.bc-task-center{width:min(650px,calc(100vw - 32px));max-height:min(680px,calc(100vh - 40px));overflow:hidden;border:1px solid var(--border-standard);border-radius:14px;background:var(--bg-surface);box-shadow:0 24px 80px rgba(0,0,0,.42);display:flex;flex-direction:column}
      .bc-task-center-head{display:flex;align-items:center;padding:13px 15px;border-bottom:1px solid var(--border-standard)}.bc-task-center-head strong{font-size:14px}.bc-task-center-head small{margin-left:8px;color:var(--text-tertiary)}.bc-task-center-head button{margin-left:auto;border:0;background:transparent;color:var(--text-tertiary);font-size:20px;cursor:pointer}.bc-task-center-body{overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
      .bc-task-row{padding:10px 11px;border:1px solid var(--border-standard);border-radius:9px;background:var(--bg-elevated)}.bc-task-row-head{display:flex;align-items:center;gap:8px}.bc-task-row-head strong{font-size:12px}.bc-task-state{padding:2px 6px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-size:9.5px}.bc-task-row-meta{margin-top:5px;color:var(--text-tertiary);font-size:10.5px}.bc-task-actions{display:flex;gap:6px;margin-top:8px}.bc-task-actions button{height:26px;padding:0 8px;border:1px solid var(--border-standard);border-radius:6px;background:var(--bg-surface);color:var(--text-secondary);font-size:10.5px;cursor:pointer}.bc-task-history-title{margin:7px 2px 0;color:var(--text-secondary);font-size:11px;font-weight:700}.bc-task-empty{padding:26px 12px;text-align:center;color:var(--text-tertiary);font-size:11.5px}
      @media (max-width:640px){.bc-workbench-nav{grid-template-columns:repeat(2,1fr)}.bc-review-grid{grid-template-columns:1fr}}
      @media (prefers-reduced-motion:reduce){.bc-workbench-step,.bc-workbench-status i{transition:none!important;animation:none!important}}
    `;
    document.head.appendChild(style);
  }

  async function listAccounts() {
    const listed = await window.api.accounts.list();
    return listed?.accounts || listed || [];
  }

  function ensureInlineStatus() {
    const meta = document.getElementById('broadcast-meta');
    if (!meta) return null;
    let status = document.getElementById('broadcast-workbench-status');
    if (!status) {
      status = document.createElement('div');
      status.id = 'broadcast-workbench-status';
      status.className = 'bc-workbench-status';
      status.setAttribute('role', 'status');
      status.innerHTML = '<i></i><span>联系人与群组会在后台同步</span>';
      meta.parentElement?.insertBefore(status, meta);
    }
    return status;
  }

  function setInlineStatus(text, state = 'ready') {
    const status = ensureInlineStatus();
    if (!status) return;
    if (status.dataset.state !== state) status.dataset.state = state;
    const span = status.querySelector('span');
    if (span && span.textContent !== text) span.textContent = text;
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
    card = document.createElement('section');
    card.id = 'broadcast-review-card';
    card.className = 'bc-card bc-review-card';
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
    const values = {
      account: account ? `${account.name || '当前账号'} · ${platform}` : '当前账号',
      audience: count ? `${count} 个对象` : '尚未选择对象',
      time: Number.isFinite(scheduledAt) && scheduledAt > Date.now() ? formatDateTime(scheduledAt) : '立即发送',
      interval: `${lo}–${hi} 秒 · 随机等待`,
      extras: `${files} 个附件 · ${vcards} 张名片`,
      message: text ? text.slice(0, 320) : (files || vcards ? '无文本，仅发送附件或名片' : '未填写文本消息')
    };
    for (const [key, value] of Object.entries(values)) {
      const node = card.querySelector(`[data-review="${key}"]`);
      if (node) node.textContent = value;
    }
  }

  function setStep(step) {
    if (!STEP_IDS.includes(step)) return;
    currentStep = step;
    document.querySelectorAll('#broadcast-overlay .bc-card').forEach(card => {
      const own = stepForCard(card);
      if (own) card.dataset.workbenchHidden = own === step ? 'false' : 'true';
    });
    document.querySelectorAll('.bc-workbench-step').forEach(button => {
      button.dataset.active = button.dataset.step === step ? 'true' : 'false';
    });
    const send = document.getElementById('broadcast-send');
    const next = document.getElementById('broadcast-workbench-next');
    const prev = document.getElementById('broadcast-workbench-prev');
    if (send) send.style.display = step === 'review' ? '' : 'none';
    if (next) next.style.display = step === 'review' ? 'none' : '';
    if (prev) prev.disabled = step === STEP_IDS[0];
    if (step === 'review') void refreshReview();
    document.querySelector('#broadcast-overlay .bc-body')?.scrollTo?.({ top: 0, behavior: 'smooth' });
  }

  function ensureStepper() {
    const header = document.querySelector('#broadcast-overlay .bc-header');
    if (!header || document.getElementById('broadcast-workbench-nav')) return;
    const nav = document.createElement('nav');
    nav.id = 'broadcast-workbench-nav';
    nav.className = 'bc-workbench-nav';
    nav.setAttribute('aria-label', '群发创建步骤');
    [['content', '1', '消息内容'], ['audience', '2', '发送对象'], ['settings', '3', '发送设置'], ['review', '4', '检查发送']].forEach(([id, num, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bc-workbench-step';
      button.dataset.step = id;
      button.innerHTML = `<b>${num}</b><span>${label}</span>`;
      button.onclick = () => setStep(id);
      nav.appendChild(button);
    });
    header.insertAdjacentElement('afterend', nav);
  }

  function ensureFooterNavigation() {
    const footer = document.querySelector('#broadcast-overlay .bc-footer__btns');
    if (!footer || document.getElementById('broadcast-workbench-next')) return;
    const tools = document.createElement('div');
    tools.className = 'bc-workbench-footer-tools';
    const prev = document.createElement('button');
    prev.id = 'broadcast-workbench-prev';
    prev.type = 'button';
    prev.textContent = '上一步';
    const next = document.createElement('button');
    next.id = 'broadcast-workbench-next';
    next.type = 'button';
    next.textContent = '下一步';
    prev.onclick = () => setStep(STEP_IDS[Math.max(0, STEP_IDS.indexOf(currentStep) - 1)]);
    next.onclick = () => setStep(STEP_IDS[Math.min(STEP_IDS.length - 1, STEP_IDS.indexOf(currentStep) + 1)]);
    tools.append(prev, next);
    footer.insertBefore(tools, footer.firstChild);
  }

  function resetWorkbenchOnOpen() {
    ensureStepper();
    ensureFooterNavigation();
    ensureReviewCard();
    setStep('content');
    setInlineStatus('正在后台同步联系人与群组，可继续编辑消息', 'loading');
  }

  function syncContactStatus() {
    const text = String(document.getElementById('broadcast-meta')?.textContent || '');
    if (/^共\s*\d+\s*个聊天/.test(text)) setInlineStatus('联系人与群组已就绪', 'ready');
    else if (/失败|不可用/.test(text)) setInlineStatus('联系人暂未就绪，不影响编辑；可稍后重新打开群发重试', 'error');
    else if (/加载|读取|同步/.test(text)) setInlineStatus('正在后台同步联系人与群组，可继续编辑消息', 'loading');
  }

  function ensureTaskCenter() {
    let overlay = document.getElementById('broadcast-task-center-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'broadcast-task-center-overlay';
    overlay.className = 'bc-task-center-overlay hidden';
    overlay.innerHTML = `<section class="bc-task-center" role="dialog" aria-modal="true" aria-label="群发任务中心"><header class="bc-task-center-head"><strong>群发任务</strong><small>当前账号</small><button type="button" aria-label="关闭">×</button></header><div class="bc-task-center-body"></div></section>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.bc-task-center-head button').onclick = () => overlay.classList.add('hidden');
    overlay.onclick = event => { if (event.target === overlay) overlay.classList.add('hidden'); };
    return overlay;
  }

  function jobRow(job, manager) {
    const row = document.createElement('article');
    row.className = 'bc-task-row';
    const total = Number(job.total) || 0;
    const current = Number(job.current) || 0;
    row.innerHTML = `<div class="bc-task-row-head"><strong>${jobStatusLabel(job)}</strong><span class="bc-task-state">${job.state}</span></div><div class="bc-task-row-meta">${current}/${total} · 成功 ${Number(job.ok) || 0} · 失败 ${Number(job.fail) || 0}${job.scheduledAt ? ` · ${formatDateTime(job.scheduledAt)}` : ''}</div>`;
    if (!TERMINAL.has(job.state)) {
      const actions = document.createElement('div');
      actions.className = 'bc-task-actions';
      if (job.state === 'running' || job.state === 'paused') {
        const pause = document.createElement('button');
        pause.type = 'button';
        pause.textContent = job.state === 'paused' ? '继续' : '暂停';
        pause.onclick = async () => {
          await manager.invoke(job.id, job.state === 'paused' ? 'resume' : 'pause').catch(() => {});
          void renderTaskCenter();
        };
        actions.appendChild(pause);
      }
      const stop = document.createElement('button');
      stop.type = 'button';
      stop.textContent = job.state === 'scheduled' ? '取消定时' : job.state === 'queued' ? '取消排队' : '停止后续发送';
      stop.onclick = async () => {
        await manager.invoke(job.id, 'stop').catch(() => {});
        void renderTaskCenter();
      };
      actions.appendChild(stop);
      row.appendChild(actions);
    }
    return row;
  }

  async function renderTaskCenter() {
    const overlay = ensureTaskCenter();
    const body = overlay.querySelector('.bc-task-center-body');
    const manager = window.GeekBroadcastJobs;
    const accountId = activeAccountId();
    if (!body || !manager || !accountId) return;
    body.replaceChildren();
    const jobs = manager.list(accountId).slice().reverse();
    if (jobs.length) jobs.forEach(job => body.appendChild(jobRow(job, manager)));
    else {
      const empty = document.createElement('div');
      empty.className = 'bc-task-empty';
      empty.textContent = '当前账号还没有本次会话的群发任务';
      body.appendChild(empty);
    }
    let history = [];
    try {
      const data = await window.api.accountData.getAll(accountId);
      const parsed = JSON.parse(data?.sendHistory || '[]');
      if (Array.isArray(parsed)) history = parsed.slice(-8).reverse();
    } catch (_) {}
    if (history.length) {
      const title = document.createElement('div');
      title.className = 'bc-task-history-title';
      title.textContent = '最近发送记录';
      body.appendChild(title);
      history.forEach(item => {
        const row = document.createElement('article');
        row.className = 'bc-task-row';
        row.innerHTML = `<div class="bc-task-row-head"><strong>发送记录</strong><span class="bc-task-state">历史</span></div><div class="bc-task-row-meta">${formatDateTime(item.t)} · 共 ${Number(item.total) || 0} · 成功 ${Number(item.ok) || 0} · 失败 ${Number(item.fail) || 0} · 附件 ${Number(item.files) || 0}</div>`;
        body.appendChild(row);
      });
    }
  }

  function openTaskCenter() {
    const overlay = ensureTaskCenter();
    overlay.classList.remove('hidden');
    void renderTaskCenter();
  }

  function ensureTaskButton() {
    const trigger = document.getElementById('btn-broadcast');
    if (!trigger || document.getElementById('broadcast-task-center-button')) return;
    const button = document.createElement('button');
    button.id = 'broadcast-task-center-button';
    button.type = 'button';
    button.className = 'bc-task-center-button';
    button.textContent = '任务';
    button.title = '查看当前账号群发任务';
    button.onclick = event => { event.stopPropagation(); openTaskCenter(); };
    trigger.insertAdjacentElement('afterend', button);
  }

  function installOverlayObserver() {
    const overlay = document.getElementById('broadcast-overlay');
    if (!overlay) return;
    const meta = document.getElementById('broadcast-meta');
    const syncOverlay = () => {
      const isOpen = !overlay.classList.contains('hidden');
      if (isOpen && !overlayWasOpen) resetWorkbenchOnOpen();
      overlayWasOpen = isOpen;
      if (isOpen) syncContactStatus();
    };
    const overlayObserver = new MutationObserver(syncOverlay);
    overlayObserver.observe(overlay, { attributes: true, attributeFilter: ['class'] });
    if (meta) {
      const metaObserver = new MutationObserver(() => {
        if (!overlay.classList.contains('hidden')) syncContactStatus();
      });
      metaObserver.observe(meta, { subtree: true, childList: true, characterData: true });
    }
    syncOverlay();
  }

  function install() {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    injectStyles();
    ensureStepper();
    ensureFooterNavigation();
    ensureReviewCard();
    ensureTaskButton();
    ensureTaskCenter();
    setStep('content');
    installOverlayObserver();
    document.addEventListener('input', () => { if (currentStep === 'review') void refreshReview(); }, true);
    document.addEventListener('change', () => { if (currentStep === 'review') void refreshReview(); }, true);
    window.GeekBroadcastJobs?.subscribe?.(() => {
      if (!document.getElementById('broadcast-task-center-overlay')?.classList.contains('hidden')) void renderTaskCenter();
    });
  }

  return Object.freeze({ install, jobStatusLabel, formatDateTime, stepForCard });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastWorkbench.install(), { once: true });
  else window.GeekBroadcastWorkbench.install();
}
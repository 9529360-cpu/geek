(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastLaunchCheck = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const LONG_WAIT_SECONDS = 30 * 60;
  let installed = false;
  let refreshQueued = false;
  let observer = null;
  let managerUnsubscribe = null;

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function estimateWaitWindow(total, intervalMin, intervalMax) {
    const count = Math.max(0, Math.floor(finiteNumber(total, 0)));
    const min = Math.max(5, finiteNumber(intervalMin, 5));
    const max = Math.max(min, finiteNumber(intervalMax, Math.max(10, min)));
    const gaps = Math.max(0, count - 1);
    return Object.freeze({
      gaps,
      intervalMin: min,
      intervalMax: max,
      minSeconds: gaps * min,
      maxSeconds: gaps * max,
    });
  }

  function formatDuration(seconds) {
    const value = Math.max(0, Math.round(finiteNumber(seconds, 0)));
    if (value < 60) return `${value} 秒`;
    if (value < 3600) {
      const minutes = Math.floor(value / 60);
      const rest = value % 60;
      return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
    }
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    return minutes ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
  }

  function freezeMessages(items) {
    return Object.freeze(items.map(item => Object.freeze({ ...item })));
  }

  function assessLaunchPlan(snapshot = {}) {
    const blockers = [];
    const warnings = [];
    const notices = [];
    const audience = snapshot.audience || {};
    const scheduleEnabled = snapshot.scheduleEnabled === true;
    const countKnown = audience.countKnown === true;
    const count = Math.max(0, Math.floor(finiteNumber(audience.count, 0)));
    const wait = countKnown ? estimateWaitWindow(count, snapshot.intervalMin, snapshot.intervalMax) : null;

    if (!String(snapshot.accountId || '').trim()) {
      blockers.push({ code: 'ACCOUNT_REQUIRED', text: '请选择发送账号。' });
    }
    if (snapshot.contentPresent !== true) {
      blockers.push({ code: 'CONTENT_REQUIRED', text: '至少填写消息、添加附件或选择电子名片。' });
    }
    if (audience.selectionReady === false) {
      blockers.push({ code: 'AUDIENCE_REQUIRED', text: String(audience.blockerText || '请选择发送对象。') });
    } else if (countKnown && count <= 0) {
      blockers.push({ code: 'AUDIENCE_EMPTY', text: '当前发送范围没有可用对象。' });
    }

    if (scheduleEnabled) {
      if (snapshot.scheduleValid !== true) {
        blockers.push({ code: 'SCHEDULE_INVALID', text: '请选择未来的发送时间；无效或已过去的时间不会自动改成立即发送。' });
      } else if (snapshot.schedulePersistenceReady === false) {
        blockers.push({ code: 'SCHEDULE_PERSISTENCE_NOT_READY', text: '定时任务持久化尚未就绪，请稍后重试。' });
      }
      if (snapshot.activeJob === true) {
        warnings.push({ code: 'SCHEDULE_MAY_QUEUE', text: '当前账号正在群发；如果到点时仍未结束，这条定时任务会进入排队。' });
      }
      if (finiteNumber(snapshot.pendingJobs, 0) > 0) {
        warnings.push({ code: 'SCHEDULE_QUEUE_PRESSURE', text: `当前账号已有 ${Math.floor(finiteNumber(snapshot.pendingJobs, 0))} 条排队或定时任务，请留意执行顺序。` });
      }
      notices.push({ code: 'FIXED_AUDIENCE', text: '定时任务创建时固定受众快照，之后切换账号或筛选不会改写任务对象。' });
    } else if (snapshot.activeJob === true) {
      blockers.push({ code: 'ACCOUNT_BUSY', text: '当前账号已有执行中的群发任务；可先到群发指挥台查看、暂停或停止。' });
    }

    if (audience.finalExact === false && audience.selectionReady !== false) {
      notices.push({ code: 'AUDIENCE_RESOLVED_AT_SEND', text: String(audience.estimateNote || '当前显示候选范围；最终对象会在发送时按现有筛选和平台数据解析。') });
    }
    if (snapshot.contactsReady === false && ['all', 'all-contacts', 'all-groups', 'exclude-contacts', 'exclude-groups'].includes(String(audience.mode || ''))) {
      warnings.push({ code: 'AUDIENCE_SYNCING', text: '联系人与群组仍在同步，当前候选数量可能继续变化。' });
    }
    if (snapshot.importedAudience === true && snapshot.usesNameVariable === true) {
      warnings.push({ code: 'IMPORTED_NAME_VARIABLE', text: '导入号码使用了联系人名称变量；无法解析姓名时可能退化为号码或空名称，请先确认消息预览。' });
    }
    if (wait && wait.maxSeconds >= LONG_WAIT_SECONDS) {
      warnings.push({ code: 'LONG_RANDOM_WAIT', text: `仅随机间隔预计就需要 ${formatDuration(wait.minSeconds)}–${formatDuration(wait.maxSeconds)}，实际完成时间还会更长。` });
    }
    if (scheduleEnabled && finiteNumber(snapshot.fileCount, 0) > 0) {
      notices.push({ code: 'SCHEDULED_FILE_RECHECK', text: '定时附件会在执行前重新校验；文件被移动、替换或修改时任务会安全失败而不是发送不确定内容。' });
    }

    notices.push({ code: 'COMPLIANCE', text: '只向预期收到消息的对象发送；投诉、举报或异常高频行为可能触发平台限制。' });

    const state = blockers.length ? 'block' : warnings.length ? 'warn' : 'ready';
    return Object.freeze({
      state,
      blockers: freezeMessages(blockers),
      warnings: freezeMessages(warnings),
      notices: freezeMessages(notices),
      wait,
    });
  }

  function activeAccountId(doc = document) {
    return String(doc.querySelector('.nav-account.active[data-id]')?.dataset.id || '');
  }

  function parsedCount(text) {
    const match = String(text || '').match(/(?:已导入\s*)?(\d+)/);
    return match ? Number(match[1]) || 0 : 0;
  }

  function collectAudience(doc = document, win = window) {
    const mode = String(doc.querySelector('input[name="bc-sendto"]:checked')?.value || 'custom');
    const metaText = String(doc.getElementById('broadcast-meta')?.textContent || '');
    const contactsReady = /^共\s*\d+\s*个聊天/.test(metaText);
    const result = { mode, count: 0, countKnown: true, finalExact: true, selectionReady: true, blockerText: '', estimateNote: '' };

    if (mode === 'custom') {
      result.count = doc.querySelectorAll('#bc-selected-chips .bc-selected-chip').length;
    } else if (mode === 'paste') {
      result.count = Number(doc.getElementById('bc-paste-total')?.textContent) || 0;
      result.finalExact = false;
      result.estimateNote = '当前显示导入号码的候选数量；号码可用性和去重结果会在发送时核验。';
    } else if (mode === 'excel') {
      result.count = parsedCount(doc.getElementById('bc-excel-meta')?.textContent || '');
      result.finalExact = false;
      result.estimateNote = '当前显示文件导入的候选数量；号码可用性和去重结果会在发送时核验。';
    } else if (mode === 'group-members') {
      const groups = doc.getElementById('bc-group-members-select')?.selectedOptions?.length || 0;
      result.countKnown = false;
      result.finalExact = false;
      result.selectionReady = groups > 0;
      result.blockerText = '请先选择至少一个群组。';
      result.estimateNote = groups > 0 ? `已选择 ${groups} 个群组；成员会在发送时解析并去重。` : '';
    } else if (mode === 'label') {
      const selected = !!doc.getElementById('bc-label-select')?.value;
      result.countKnown = false;
      result.finalExact = false;
      result.selectionReady = selected;
      result.blockerText = '请先选择标签。';
      result.estimateNote = selected ? '标签对象会在发送时按当前账号数据解析并去重。' : '';
    } else if (['all', 'all-contacts', 'all-groups', 'exclude-contacts', 'exclude-groups'].includes(mode)) {
      const estimate = Number(win.__geekBroadcastAudienceEstimate?.());
      result.count = Number.isFinite(estimate) ? Math.max(0, estimate) : 0;
      result.countKnown = Number.isFinite(estimate);
      result.finalExact = contactsReady;
      result.selectionReady = contactsReady ? result.count > 0 : true;
      result.estimateNote = contactsReady ? '' : '联系人与群组仍在同步；这里显示的是当前已解析候选范围。';
    } else {
      result.count = doc.querySelectorAll('#bc-selected-chips .bc-selected-chip').length;
    }

    return Object.freeze({ ...result, contactsReady });
  }

  function schedulePersistenceReady(win = window) {
    const registry = win.GeekBroadcastScheduleRegistry;
    if (typeof registry?.schedulePersistenceReady === 'function') return registry.schedulePersistenceReady();
    return typeof win.GeekBroadcastSchedulePersistenceInstance?.awaitScheduledDurable === 'function';
  }

  function collectSnapshot(doc = document, win = window) {
    const accountId = activeAccountId(doc);
    const audience = collectAudience(doc, win);
    const message = String(doc.getElementById('broadcast-message')?.value || '');
    const fileCount = doc.querySelectorAll('#broadcast-files .bf-item').length;
    const vcardCount = Array.isArray(win.__vcardContacts) ? win.__vcardContacts.length : 0;
    const scheduleEnabled = doc.getElementById('broadcast-schedule-toggle')?.checked === true;
    const rawSchedule = doc.getElementById('broadcast-schedule-time')?.value || '';
    const scheduledAt = rawSchedule ? new Date(rawSchedule).getTime() : NaN;
    const scheduleValid = Number.isFinite(scheduledAt) && scheduledAt > Date.now();
    const manager = win.GeekBroadcastJobs;
    const activeJob = !!(accountId && manager?.hasActive?.(accountId));
    const pendingJobs = accountId && typeof manager?.getPending === 'function' ? manager.getPending(accountId).length : 0;
    const intervalMin = Math.max(5, finiteNumber(doc.getElementById('broadcast-interval-min')?.value, 5));
    const intervalMax = Math.max(intervalMin, finiteNumber(doc.getElementById('broadcast-interval-max')?.value, Math.max(10, intervalMin)));
    const contactsReady = audience.contactsReady !== false;

    return Object.freeze({
      accountId,
      audience,
      contentPresent: !!message.trim() || fileCount > 0 || vcardCount > 0,
      message,
      fileCount,
      vcardCount,
      scheduleEnabled,
      scheduledAt: Number.isFinite(scheduledAt) ? scheduledAt : null,
      scheduleValid: !scheduleEnabled || scheduleValid,
      schedulePersistenceReady: !scheduleEnabled || !scheduleValid ? true : schedulePersistenceReady(win),
      intervalMin,
      intervalMax,
      activeJob,
      pendingJobs,
      contactsReady,
      importedAudience: audience.mode === 'paste' || audience.mode === 'excel',
      usesNameVariable: /%nc|%nr/i.test(message),
    });
  }

  function injectStyles(doc = document) {
    if (doc.getElementById('broadcast-launch-check-style')) return;
    const style = doc.createElement('style');
    style.id = 'broadcast-launch-check-style';
    style.textContent = `
      .bc-launch-check{padding:11px;border:1px solid var(--border-standard);border-radius:10px;background:color-mix(in srgb,var(--bg-surface) 72%,var(--bg-elevated));display:flex;flex-direction:column;gap:9px}
      .bc-launch-check-head{display:flex;align-items:flex-start;gap:9px}.bc-launch-check-head>div{min-width:0;flex:1}.bc-launch-check-head strong{display:block;font-size:12px}.bc-launch-check-head small{display:block;margin-top:2px;color:var(--text-tertiary);font-size:10px;line-height:1.4}
      .bc-launch-check-state{flex:0 0 auto;padding:3px 7px;border:1px solid var(--border-standard);border-radius:999px;background:var(--bg-elevated);color:var(--text-secondary);font-size:9.5px;font-weight:700}.bc-launch-check[data-state="ready"] .bc-launch-check-state{border-color:color-mix(in srgb,var(--accent) 38%,var(--border-standard));background:var(--accent-soft);color:var(--accent)}.bc-launch-check[data-state="warn"] .bc-launch-check-state{color:#d99b48}.bc-launch-check[data-state="block"] .bc-launch-check-state{color:#ff8b82}
      .bc-launch-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.bc-launch-metric{padding:7px 8px;border:1px solid var(--border-standard);border-radius:8px;background:var(--bg-elevated);min-width:0}.bc-launch-metric small{display:block;color:var(--text-tertiary);font-size:9px}.bc-launch-metric strong{display:block;margin-top:2px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .bc-launch-findings{display:flex;flex-direction:column;gap:5px}.bc-launch-finding{display:flex;align-items:flex-start;gap:6px;padding:6px 7px;border-radius:7px;background:var(--bg-elevated);color:var(--text-secondary);font-size:10px;line-height:1.45}.bc-launch-finding b{flex:0 0 auto;width:14px;text-align:center}.bc-launch-finding[data-tone="block"]{color:#ff9b91}.bc-launch-finding[data-tone="warn"]{color:#d9a35b}.bc-launch-finding[data-tone="ok"]{color:var(--accent)}
      @media (max-width:640px){.bc-launch-metrics{grid-template-columns:1fr}.bc-launch-check-head{align-items:center}}
    `;
    doc.head.appendChild(style);
  }

  function ensureCard(doc = document) {
    const review = doc.getElementById('broadcast-review-card');
    if (!review) return null;
    let card = doc.getElementById('broadcast-launch-check');
    if (card) return card;
    card = doc.createElement('section');
    card.id = 'broadcast-launch-check';
    card.className = 'bc-launch-check';
    card.setAttribute('aria-label', '发送前检查');
    card.innerHTML = `<div class="bc-launch-check-head"><div><strong>发送前检查</strong><small>基于当前草稿做实时体检；最终发送仍由账号运行时和安全校验决定</small></div><span class="bc-launch-check-state" role="status" aria-live="polite" aria-atomic="true">检查中</span></div><div class="bc-launch-metrics"><div class="bc-launch-metric"><small>候选对象</small><strong data-launch-metric="audience">—</strong></div><div class="bc-launch-metric"><small>随机等待</small><strong data-launch-metric="wait">—</strong></div><div class="bc-launch-metric"><small>账号任务</small><strong data-launch-metric="queue">—</strong></div></div><div class="bc-launch-findings" data-launch-findings></div>`;
    review.appendChild(card);
    return card;
  }

  function audienceMetric(audience) {
    if (!audience) return '—';
    if (audience.countKnown === true) {
      const count = Math.max(0, Math.floor(finiteNumber(audience.count, 0)));
      return audience.finalExact === false ? `${count} 个候选` : `${count} 个对象`;
    }
    if (audience.mode === 'label') return audience.selectionReady ? '标签 · 发送时解析' : '未选择标签';
    if (audience.mode === 'group-members') return audience.selectionReady ? '群成员 · 发送时解析' : '未选择群组';
    return '发送时解析';
  }

  function waitMetric(plan) {
    if (!plan?.wait) return '发送时解析';
    if (plan.wait.maxSeconds <= 0) return '无需随机等待';
    return `${formatDuration(plan.wait.minSeconds)}–${formatDuration(plan.wait.maxSeconds)}`;
  }

  function queueMetric(snapshot) {
    if (snapshot.activeJob) return snapshot.scheduleEnabled ? '忙碌 · 到点可能排队' : '忙碌 · 立即发送被阻止';
    if (finiteNumber(snapshot.pendingJobs, 0) > 0) return `${Math.floor(finiteNumber(snapshot.pendingJobs, 0))} 条待发送`;
    return '当前账号空闲';
  }

  function render(doc, snapshot, plan) {
    const card = ensureCard(doc);
    if (!card) return false;
    card.dataset.state = plan.state;
    const state = card.querySelector('.bc-launch-check-state');
    if (state) state.textContent = plan.state === 'block' ? `需处理 ${plan.blockers.length} 项` : plan.state === 'warn' ? `可发送 · ${plan.warnings.length} 项提醒` : '可以发送';
    const audience = card.querySelector('[data-launch-metric="audience"]');
    const wait = card.querySelector('[data-launch-metric="wait"]');
    const queue = card.querySelector('[data-launch-metric="queue"]');
    if (audience) audience.textContent = audienceMetric(snapshot.audience);
    if (wait) wait.textContent = waitMetric(plan);
    if (queue) queue.textContent = queueMetric(snapshot);

    const findings = card.querySelector('[data-launch-findings]');
    if (!findings) return true;
    findings.replaceChildren();
    const rows = [
      ...plan.blockers.map(item => ({ ...item, tone: 'block', icon: '!' })),
      ...plan.warnings.map(item => ({ ...item, tone: 'warn', icon: '△' })),
      ...plan.notices.map(item => ({ ...item, tone: 'info', icon: 'i' })),
    ];
    if (!rows.length) rows.push({ tone: 'ok', icon: '✓', text: '当前草稿没有发现需要处理的发送前问题。' });
    for (const item of rows.slice(0, 6)) {
      const row = doc.createElement('div');
      row.className = 'bc-launch-finding';
      row.dataset.tone = item.tone;
      const icon = doc.createElement('b');
      icon.textContent = item.icon;
      icon.setAttribute('aria-hidden', 'true');
      const text = doc.createElement('span');
      text.textContent = item.text;
      row.append(icon, text);
      findings.appendChild(row);
    }
    if (rows.length > 6) {
      const more = doc.createElement('div');
      more.className = 'bc-launch-finding';
      more.dataset.tone = 'info';
      more.textContent = `还有 ${rows.length - 6} 条提示；优先处理上面的阻断和提醒。`;
      findings.appendChild(more);
    }
    return true;
  }

  function refresh(doc = document, win = window) {
    const review = doc.getElementById('broadcast-review-card');
    if (!review) return null;
    const snapshot = collectSnapshot(doc, win);
    const plan = assessLaunchPlan(snapshot);
    render(doc, snapshot, plan);
    return Object.freeze({ snapshot, plan });
  }

  function scheduleRefresh(doc = document, win = window) {
    if (refreshQueued) return;
    refreshQueued = true;
    const defer = typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame.bind(win) : callback => setTimeout(callback, 0);
    defer(() => {
      refreshQueued = false;
      refresh(doc, win);
    });
  }

  function install(doc = document, win = window) {
    if (installed || !doc?.addEventListener) return false;
    installed = true;
    injectStyles(doc);
    ensureCard(doc);
    refresh(doc, win);

    doc.addEventListener('input', event => {
      if (event.target?.closest?.('#broadcast-overlay')) scheduleRefresh(doc, win);
    }, true);
    doc.addEventListener('change', event => {
      if (event.target?.closest?.('#broadcast-overlay')) scheduleRefresh(doc, win);
    }, true);
    doc.addEventListener('click', event => {
      if (event.target?.closest?.('#broadcast-overlay')) scheduleRefresh(doc, win);
    }, true);

    const overlay = doc.getElementById('broadcast-overlay');
    if (overlay && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(records => {
        const external = records.some(record => !record.target?.closest?.('#broadcast-launch-check'));
        if (external) scheduleRefresh(doc, win);
      });
      observer.observe(overlay, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'value'] });
    }

    if (typeof win.GeekBroadcastJobs?.subscribe === 'function') {
      managerUnsubscribe = win.GeekBroadcastJobs.subscribe(event => {
        if (!event?.job || String(event.job.accountId || '') === activeAccountId(doc)) scheduleRefresh(doc, win);
      });
    }

    win.GeekBroadcastLaunchCheckInstance = Object.freeze({
      refresh: () => refresh(doc, win),
      dispose: () => {
        observer?.disconnect?.();
        observer = null;
        managerUnsubscribe?.();
        managerUnsubscribe = null;
      },
    });
    return true;
  }

  return Object.freeze({ estimateWaitWindow, formatDuration, assessLaunchPlan, collectAudience, collectSnapshot, install });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastLaunchCheck.install(), { once: true });
  else window.GeekBroadcastLaunchCheck.install();
}

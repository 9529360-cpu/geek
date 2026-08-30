(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekAccountCenter = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const PLANS = Object.freeze({
    basic: Object.freeze({ name: '基础包', chars: 1000000, price: 25 }),
    standard: Object.freeze({ name: '标准包', chars: 1500000, price: 48 }),
    pro: Object.freeze({ name: '大包', chars: 4500000, price: 128 }),
  });

  function planLabel(plan) {
    const item = PLANS[String(plan || '')];
    return item ? `${item.name} · ${(item.chars / 10000).toLocaleString('zh-CN')} 万字符` : String(plan || '字符包');
  }

  function orderStatusLabel(status) {
    const value = String(status || '').toLowerCase();
    if (value === 'paid') return '已完成';
    if (value === 'processing') return '确认中';
    if (value === 'pending') return '待确认';
    if (value === 'cancelled' || value === 'canceled') return '已取消';
    return value || '未知';
  }

  function normalizeOrders(payload) {
    const source = Array.isArray(payload) ? payload : payload?.orders;
    if (!Array.isArray(source)) return [];
    return source.filter(item => item && typeof item === 'object').slice(0, 5);
  }

  function install() {
    if (typeof document === 'undefined' || !window.api?.subscription) return false;
    if (document.getElementById('settings-profile')) return true;

    if (!document.querySelector('link[data-geek-account-center]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = './account-center.css';
      link.dataset.geekAccountCenter = 'true';
      document.head.appendChild(link);
    }

    const overlay = document.getElementById('settings-overlay');
    const tabs = overlay?.querySelector('.settings-tabs');
    const globalTab = tabs?.querySelector('.settings-tab[data-tab="global"]');
    const accountTab = tabs?.querySelector('.settings-tab[data-tab="account"]');
    const globalPanel = document.getElementById('settings-global');
    const accountPanel = document.getElementById('settings-account');
    const saveButton = document.getElementById('settings-save');
    const cancelButton = document.getElementById('settings-cancel');
    const headerTitle = overlay?.querySelector('.settings-head-copy > span');
    const headerSub = overlay?.querySelector('.settings-head-copy > small');
    if (!overlay || !tabs || !globalTab || !accountTab || !globalPanel || !accountPanel) return false;

    const profileTab = document.createElement('button');
    profileTab.type = 'button';
    profileTab.className = 'settings-tab';
    profileTab.dataset.tab = 'profile';
    profileTab.textContent = '个人中心';
    tabs.insertBefore(profileTab, globalTab);
    globalTab.textContent = '应用设置';
    accountTab.style.display = 'none';
    accountTab.setAttribute('aria-hidden', 'true');

    const profile = document.createElement('div');
    profile.id = 'settings-profile';
    profile.className = 'settings-body settings-body--cards geek-profile';
    profile.innerHTML = `
      <section class="settings-card geek-profile-account">
        <div class="geek-profile-identity">
          <div class="geek-profile-avatar" aria-hidden="true">G</div>
          <div class="geek-profile-identity-copy">
            <div class="settings-card-title">Geek 账户</div>
            <div id="geek-profile-email" class="geek-profile-email">正在读取…</div>
          </div>
          <span id="geek-profile-state" class="geek-profile-badge">已登录</span>
        </div>
        <div class="geek-profile-row"><span>账号号</span><div><strong id="geek-profile-ref">—</strong><button type="button" id="geek-profile-copy" class="geek-link-btn">复制</button></div></div>
      </section>

      <section id="geek-profile-quota" class="settings-card geek-profile-quota">
        <div class="geek-profile-section-head"><div><div class="settings-card-title">翻译字符</div><div class="settings-card-sub">字符只用于翻译；用完后 WhatsApp、Telegram、LINE 仍可正常使用。</div></div><button type="button" id="geek-profile-refresh" class="btn-plain">刷新</button></div>
        <div id="geek-profile-quota-number" class="geek-profile-quota-number">—</div>
        <div id="geek-profile-quota-note" class="geek-profile-quota-note">正在读取余额…</div>
      </section>

      <section class="settings-card">
        <div class="settings-card-title">购买字符</div>
        <div class="settings-card-sub">字符包买断不限时。生成订单后按订单号完成付款，确认后余额会自动增加。</div>
        <div class="geek-plan-grid">
          <button type="button" class="geek-plan" data-plan="basic"><strong>基础包</strong><span>100 万字符</span><b>$25</b></button>
          <button type="button" class="geek-plan geek-plan--recommended" data-plan="standard"><em>推荐</em><strong>标准包</strong><span>150 万字符</span><b>$48</b></button>
          <button type="button" class="geek-plan" data-plan="pro"><strong>大包</strong><span>450 万字符</span><b>$128</b></button>
        </div>
        <div id="geek-order-box" class="geek-order-box hidden" aria-live="polite">
          <div><strong id="geek-order-title">订单已生成</strong><span id="geek-order-amount"></span></div>
          <p>联系客服付款时请备注 <b id="geek-order-id"></b>。确认收款后点击“刷新余额”。</p>
          <button type="button" id="geek-order-refresh" class="btn-plain">我已付款，刷新余额</button>
        </div>
      </section>

      <section class="settings-card">
        <div class="geek-profile-section-head"><div><div class="settings-card-title">最近订单</div><div class="settings-card-sub">显示最近 5 笔字符包订单。</div></div></div>
        <div id="geek-orders" class="geek-orders"><div class="geek-orders-empty">正在读取…</div></div>
      </section>

      <section class="settings-card">
        <div class="settings-card-title">账户安全</div>
        <div class="settings-card-sub">密码重置通过 Geek 官方网页和邮箱完成，不在客户端保存新密码。</div>
        <div class="geek-profile-actions">
          <button type="button" id="geek-profile-reset-password" class="btn-plain">重置密码</button>
          <button type="button" id="geek-profile-logout" class="btn-plain geek-danger-btn">退出 Geek 登录</button>
        </div>
      </section>
      <div id="geek-profile-status" class="geek-profile-status" aria-live="polite"></div>`;
    globalPanel.parentNode.insertBefore(profile, globalPanel);

    let mode = 'profile';
    let syncing = false;
    let loadRevision = 0;

    const el = id => document.getElementById(id);
    const setStatus = (text, state = '') => {
      const node = el('geek-profile-status');
      if (!node) return;
      node.textContent = String(text || '');
      node.dataset.state = state;
    };

    function applyMode(nextMode) {
      if (syncing) return;
      syncing = true;
      try {
        mode = nextMode;
        profileTab.classList.toggle('active', mode === 'profile');
        globalTab.classList.toggle('active', mode === 'global');
        accountTab.classList.toggle('active', mode === 'account');
        profile.classList.toggle('hidden', mode !== 'profile');
        globalPanel.classList.toggle('hidden', mode !== 'global');
        accountPanel.classList.toggle('hidden', mode !== 'account');
        tabs.style.display = mode === 'account' ? 'none' : '';
        if (saveButton) saveButton.classList.toggle('hidden', mode === 'profile');
        if (cancelButton) cancelButton.textContent = mode === 'profile' ? '关闭' : '取消';
        if (headerTitle) headerTitle.textContent = mode === 'account' ? '账号设置' : '设置';
        if (headerSub) headerSub.textContent = mode === 'account'
          ? '只修改当前聊天平台账号的显示与独立代理'
          : '管理 Geek 账户与应用设置';
      } finally {
        syncing = false;
      }
    }

    async function copyAccountRef() {
      const text = String(el('geek-profile-ref')?.textContent || '').trim();
      if (!text || text === '—') return;
      try {
        await navigator.clipboard.writeText(text);
        setStatus('账号号已复制 ✓', 'ok');
      } catch {
        setStatus('复制失败，请手动复制账号号', 'error');
      }
    }

    function renderOrders(payload) {
      const host = el('geek-orders');
      if (!host) return;
      const orders = normalizeOrders(payload);
      host.replaceChildren();
      if (!orders.length) {
        const empty = document.createElement('div');
        empty.className = 'geek-orders-empty';
        empty.textContent = '暂无订单';
        host.appendChild(empty);
        return;
      }
      for (const order of orders) {
        const row = document.createElement('div');
        row.className = 'geek-order-row';
        const main = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = `#${String(order.id || '—')} · ${planLabel(order.plan)}`;
        const meta = document.createElement('span');
        const amount = Number(order.amount);
        meta.textContent = `${Number.isFinite(amount) ? `$${amount}` : ''}${order.created_at ? ` · ${String(order.created_at).slice(0, 16)}` : ''}`;
        main.append(title, meta);
        const status = document.createElement('span');
        status.className = 'geek-order-status';
        status.dataset.state = String(order.status || '');
        status.textContent = orderStatusLabel(order.status);
        row.append(main, status);
        host.appendChild(row);
      }
    }

    async function refreshProfile(force = true) {
      const revision = ++loadRevision;
      setStatus('正在刷新账户信息…', 'working');
      try {
        const [state, quota, orders] = await Promise.all([
          window.api.subscription.getState(),
          window.api.subscription.getQuota(force === true),
          window.api.subscription.myOrders().catch(() => ({ orders: [] })),
        ]);
        if (revision !== loadRevision) return;
        if (!state?.loggedIn) {
          el('geek-profile-email').textContent = '当前未登录';
          el('geek-profile-ref').textContent = '—';
          el('geek-profile-quota-number').textContent = '—';
          el('geek-profile-quota-note').textContent = '请重新登录 Geek 账户';
          renderOrders([]);
          setStatus('Geek 登录状态已失效，请重新登录', 'error');
          return;
        }
        const email = String(quota?.email || state.email || '');
        const accountRef = String(quota?.account_ref || state.account_ref || '');
        const remaining = Number(quota?.remaining_chars ?? state.remaining_chars ?? 0);
        el('geek-profile-email').textContent = email || '邮箱暂不可用';
        el('geek-profile-ref').textContent = accountRef || '—';
        el('geek-profile-quota-number').textContent = Number.isFinite(remaining) ? remaining.toLocaleString('zh-CN') : '—';
        el('geek-profile-quota-note').textContent = remaining > 0
          ? '翻译字符可用'
          : '翻译字符已用完；聊天平台本身仍可正常使用';
        el('geek-profile-quota').dataset.state = remaining > 0 ? 'ok' : 'empty';
        renderOrders(orders);
        setStatus('');
      } catch (error) {
        if (revision !== loadRevision) return;
        setStatus(`账户信息刷新失败：${String(error?.message || error).slice(0, 100)}`, 'error');
      }
    }

    async function createOrder(plan) {
      const info = PLANS[plan];
      if (!info) return;
      const button = profile.querySelector(`.geek-plan[data-plan="${plan}"]`);
      if (button) button.disabled = true;
      setStatus(`正在生成${info.name}订单…`, 'working');
      try {
        const data = await window.api.subscription.createOrder(plan);
        const order = data?.order || {};
        el('geek-order-title').textContent = `${info.name}订单已生成`;
        el('geek-order-id').textContent = `#${String(order.id || '—')}`;
        const amount = Number(order.amount ?? info.price);
        el('geek-order-amount').textContent = Number.isFinite(amount) ? `$${amount}` : '';
        el('geek-order-box').classList.remove('hidden');
        const orders = await window.api.subscription.myOrders().catch(() => ({ orders: [order] }));
        renderOrders(orders);
        setStatus(data?.reuse ? '已找到未完成的同套餐订单' : '订单已生成', 'ok');
      } catch (error) {
        setStatus(`生成订单失败：${String(error?.message || error).slice(0, 100)}`, 'error');
      } finally {
        if (button) button.disabled = false;
      }
    }

    async function logout() {
      if (!window.confirm('退出 Geek 登录？聊天平台账号数据不会被删除。')) return;
      setStatus('正在退出…', 'working');
      try {
        await window.api.subscription.logout();
        await window.api.window.relaunch();
      } catch (error) {
        setStatus(`退出失败：${String(error?.message || error).slice(0, 100)}`, 'error');
      }
    }

    profileTab.addEventListener('click', () => {
      applyMode('profile');
      void refreshProfile(true);
    });
    globalTab.addEventListener('click', () => applyMode('global'));
    el('geek-profile-copy')?.addEventListener('click', copyAccountRef);
    el('geek-profile-refresh')?.addEventListener('click', () => refreshProfile(true));
    el('geek-order-refresh')?.addEventListener('click', () => refreshProfile(true));
    el('geek-profile-reset-password')?.addEventListener('click', async () => {
      setStatus('正在打开官方密码重置页面…', 'working');
      try {
        await window.api.subscription.openPasswordReset();
        setStatus('已在默认浏览器打开密码重置页面', 'ok');
      } catch (error) {
        setStatus(`无法打开密码重置页面：${String(error?.message || error).slice(0, 100)}`, 'error');
      }
    });
    el('geek-profile-logout')?.addEventListener('click', logout);
    profile.querySelectorAll('.geek-plan[data-plan]').forEach(button => {
      button.addEventListener('click', () => createOrder(button.dataset.plan));
    });

    const observer = new MutationObserver(() => {
      if (syncing) return;
      if (overlay.classList.contains('hidden')) {
        if (mode !== 'profile') applyMode('profile');
        return;
      }
      if (accountTab.classList.contains('active')) applyMode('account');
      else if (profileTab.classList.contains('active')) {
        applyMode('profile');
        void refreshProfile(false);
      } else if (globalTab.classList.contains('active')) applyMode('global');
    });
    observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
    observer.observe(profileTab, { attributes: true, attributeFilter: ['class'] });
    observer.observe(globalTab, { attributes: true, attributeFilter: ['class'] });
    observer.observe(accountTab, { attributes: true, attributeFilter: ['class'] });

    applyMode('profile');
    return true;
  }

  const api = Object.freeze({ PLANS, planLabel, orderStatusLabel, normalizeOrders, install });
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => install(), { once: true });
    else install();
  }
  return api;
});
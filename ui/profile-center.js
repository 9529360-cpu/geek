(() => {
  'use strict';

  const api = window.api;
  const sideNav = document.getElementById('side-nav');
  if (!api?.subscription || !api?.window || !sideNav) return;

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const entry = make('button', 'profile-entry');
  entry.type = 'button';
  entry.id = 'profile-center-entry';
  entry.setAttribute('aria-haspopup', 'dialog');
  entry.setAttribute('aria-expanded', 'false');

  const avatar = make('span', 'profile-entry-avatar', 'G');
  const entryCopy = make('span', 'profile-entry-copy');
  const entryTitle = make('strong', '', '个人中心');
  const entryQuota = make('small', '', '字符余量 —');
  entryCopy.append(entryTitle, entryQuota);
  entry.append(avatar, entryCopy);
  sideNav.appendChild(entry);

  const overlay = make('div', 'profile-center-overlay');
  overlay.id = 'profile-center-overlay';
  overlay.hidden = true;

  const dialog = make('section', 'profile-center-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'profile-center-title');

  const head = make('header', 'profile-center-head');
  const headCopy = make('div', 'profile-center-head-copy');
  const title = make('h2', '', '个人中心');
  title.id = 'profile-center-title';
  headCopy.append(title, make('p', '', '账户、字符余量与购买入口'));
  const closeButton = make('button', 'profile-center-close', '×');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', '关闭个人中心');
  head.append(headCopy, closeButton);

  const body = make('div', 'profile-center-body');
  const accountCard = make('section', 'profile-center-card');
  accountCard.append(make('div', 'profile-center-card-title', '账户'));
  const accountGrid = make('div', 'profile-center-grid');
  const accountRefLabel = make('span', 'profile-center-label', '账号号');
  const accountRef = make('strong', 'profile-center-value', '—');
  accountRef.id = 'profile-center-account-ref';
  const emailLabel = make('span', 'profile-center-label', '邮箱');
  const email = make('strong', 'profile-center-value', '—');
  email.id = 'profile-center-email';
  accountGrid.append(accountRefLabel, accountRef, emailLabel, email);
  accountCard.append(accountGrid);

  const quotaCard = make('section', 'profile-center-card profile-center-quota-card');
  quotaCard.append(make('div', 'profile-center-card-title', '字符余量'));
  const quotaValue = make('div', 'profile-center-quota-value', '—');
  quotaValue.id = 'profile-center-quota';
  const quotaHint = make('p', 'profile-center-quota-hint', '字符只用于翻译；用完不会影响 WhatsApp、Telegram 或 LINE 正常聊天。');
  const quotaActions = make('div', 'profile-center-actions');
  const refreshButton = make('button', 'profile-center-btn profile-center-btn--secondary', '刷新余量');
  refreshButton.type = 'button';
  const buyButton = make('button', 'profile-center-btn profile-center-btn--primary', '购买字符包');
  buyButton.type = 'button';
  quotaActions.append(refreshButton, buyButton);
  quotaCard.append(quotaValue, quotaHint, quotaActions);

  const status = make('div', 'profile-center-status', '');
  status.id = 'profile-center-status';
  status.setAttribute('aria-live', 'polite');

  const footer = make('footer', 'profile-center-footer');
  const logoutButton = make('button', 'profile-center-link', '退出登录');
  logoutButton.type = 'button';
  footer.append(logoutButton);

  body.append(accountCard, quotaCard, status);
  dialog.append(head, body, footer);
  overlay.append(dialog);
  document.body.appendChild(overlay);

  let lastFocus = null;
  let latestRemaining = null;

  function formatRemaining(value) {
    if (!Number.isFinite(value)) return '—';
    return Math.max(0, Math.floor(value)).toLocaleString('zh-CN') + ' 字符';
  }

  function setStatus(message, state = 'idle') {
    status.textContent = message || '';
    status.dataset.state = state;
  }

  function applySummary(state, quota) {
    const remainingRaw = Number(quota?.remaining_chars);
    latestRemaining = Number.isFinite(remainingRaw) ? Math.max(0, remainingRaw) : null;
    const accountNumber = quota?.account_ref || state?.account_ref || '';
    const emailValue = state?.email || '';

    accountRef.textContent = accountNumber || '暂不可用';
    email.textContent = emailValue || '暂不可用';
    quotaValue.textContent = formatRemaining(latestRemaining);
    quotaCard.dataset.state = latestRemaining === 0 ? 'empty' : 'ready';

    entryTitle.textContent = emailValue || '个人中心';
    entryQuota.textContent = latestRemaining == null ? '字符余量 —' : '剩余 ' + formatRemaining(latestRemaining);
    entry.title = (emailValue || '个人中心') + (latestRemaining == null ? '' : ' · 剩余 ' + formatRemaining(latestRemaining));
    avatar.textContent = emailValue ? emailValue.trim().charAt(0).toUpperCase() || 'G' : 'G';
  }

  async function getQuotaWithFallback(force) {
    try {
      return await api.subscription.getQuota(force === true);
    } catch (error) {
      if (force) return api.subscription.getQuota(false);
      throw error;
    }
  }

  async function loadProfile(force = false) {
    refreshButton.disabled = true;
    if (!overlay.hidden) setStatus(force ? '正在刷新字符余量…' : '正在读取账户信息…', 'saving');
    try {
      const state = await api.subscription.getState();
      if (!state?.loggedIn) {
        entryTitle.textContent = '个人中心';
        entryQuota.textContent = '未登录';
        accountRef.textContent = '—';
        email.textContent = '—';
        quotaValue.textContent = '—';
        setStatus('当前未登录', 'error');
        return;
      }
      const quota = await getQuotaWithFallback(force);
      applySummary(state, quota || {});
      setStatus(force ? '字符余量已更新' : '', 'success');
    } catch (error) {
      if (latestRemaining == null) entryQuota.textContent = '余量暂不可用';
      setStatus('账户信息暂时无法刷新，请稍后重试', 'error');
    } finally {
      refreshButton.disabled = false;
    }
  }

  function openProfile() {
    lastFocus = document.activeElement;
    overlay.hidden = false;
    entry.setAttribute('aria-expanded', 'true');
    closeButton.focus();
    loadProfile(true);
  }

  function closeProfile() {
    overlay.hidden = true;
    entry.setAttribute('aria-expanded', 'false');
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  entry.addEventListener('click', openProfile);
  closeButton.addEventListener('click', closeProfile);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) closeProfile(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.hidden) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeProfile();
    }
  });
  refreshButton.addEventListener('click', () => loadProfile(true));
  buyButton.addEventListener('click', async () => {
    buyButton.disabled = true;
    setStatus('正在打开字符套餐…', 'saving');
    try {
      await api.subscription.openPlans();
      closeProfile();
    } catch (error) {
      setStatus('暂时无法打开字符套餐，请稍后重试', 'error');
    } finally {
      buyButton.disabled = false;
    }
  });
  logoutButton.addEventListener('click', async () => {
    if (!window.confirm('退出当前极客账号？退出后需要重新登录。')) return;
    logoutButton.disabled = true;
    setStatus('正在退出登录…', 'saving');
    try {
      await api.subscription.logout();
      await api.window.relaunch();
    } catch (error) {
      logoutButton.disabled = false;
      setStatus('退出登录失败，请稍后重试', 'error');
    }
  });

  window.addEventListener('focus', () => loadProfile(false));
  loadProfile(false);
})();

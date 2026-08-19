'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content, 'utf8');
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing anchor: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Non-unique anchor: ${label}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function removeBetween(source, start, end, label) {
  const a = source.indexOf(start);
  if (a < 0) throw new Error(`Missing start anchor: ${label}`);
  const b = source.indexOf(end, a + start.length);
  if (b < 0) throw new Error(`Missing end anchor: ${label}`);
  return source.slice(0, a) + source.slice(b);
}

// index.html: load the isolated personal-center assets without expanding app.js.
{
  let source = read('ui/index.html');
  source = replaceOnce(
    source,
    '  <link rel="stylesheet" href="./settings-controller.css">\n',
    '  <link rel="stylesheet" href="./settings-controller.css">\n  <link rel="stylesheet" href="./profile-center.css">\n',
    'profile center stylesheet'
  );
  source = replaceOnce(
    source,
    '<script src="version-label.js"></script>\n<script src="app.js"></script>',
    '<script src="version-label.js"></script>\n<script src="profile-center.js"></script>\n<script src="app.js"></script>',
    'profile center script'
  );
  write('ui/index.html', source);
}

// preload: expose only the existing purchase-window capability through normalized subscription IPC.
{
  let source = read('src/preload.cjs');
  source = replaceOnce(
    source,
    "      getQuota: (force) => invokeSubscription('subscription:get-quota', force === true),\n      logout: () => invokeSubscription('subscription:logout'),",
    "      getQuota: (force) => invokeSubscription('subscription:get-quota', force === true),\n      openPlans: () => invokeSubscription('subscription:open-plans'),\n      logout: () => invokeSubscription('subscription:logout'),",
    'subscription openPlans preload API'
  );
  write('src/preload.cjs', source);
}

// main: allow the trusted renderer to reopen the existing subscription window directly on plans.
{
  let source = read('src/main.cjs');
  source = replaceOnce(
    source,
    'function createSubscriptionWindow() {',
    "function createSubscriptionWindow(initialView = '') {",
    'subscription window signature'
  );
  source = replaceOnce(
    source,
    "  subscriptionWindow.loadFile(path.join(__dirname, '../ui/subscription.html'));",
    "  const subscriptionFile = path.join(__dirname, '../ui/subscription.html');\n  if (initialView) subscriptionWindow.loadFile(subscriptionFile, { query: { view: initialView } });\n  else subscriptionWindow.loadFile(subscriptionFile);",
    'subscription window query view'
  );
  source = replaceOnce(
    source,
    "  ipcMain.handle('subscription:logout', async (event) => {\n    if (!isTrustedSubscriptionSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');\n    return initSubscriptionStore().logout();\n  });",
    "  ipcMain.handle('subscription:open-plans', async (event) => {\n    if (!isTrustedSubscriptionSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');\n    const state = await initSubscriptionStore().getState();\n    createSubscriptionWindow(state.loggedIn ? 'plans' : '');\n    return { ok: true, loggedIn: state.loggedIn === true };\n  });\n  ipcMain.handle('subscription:logout', async (event) => {\n    if (!isTrustedSubscriptionSender(event)) throw new Error('拒绝来自未授权页面的 IPC 请求');\n    return initSubscriptionStore().logout();\n  });",
    'subscription open plans handler'
  );
  source = replaceOnce(
    source,
    "  ipcMain.removeHandler('subscription:create-order');\n  ipcMain.removeHandler('subscription:logout');",
    "  ipcMain.removeHandler('subscription:create-order');\n  ipcMain.removeHandler('subscription:open-plans');\n  ipcMain.removeHandler('subscription:logout');",
    'subscription open plans cleanup'
  );
  write('src/main.cjs', source);
}

// subscription.html: authentication is now only a gate; plans remain reusable from Personal Center.
{
  let source = read('ui/subscription.html');
  source = removeBetween(
    source,
    '    <div class="card view" id="view-home">',
    '    <div class="footer-note win-drag">',
    'legacy post-login quota home'
  );
  source = replaceOnce(
    source,
    "  const $ = (s) => document.querySelector(s);\n",
    "  const $ = (s) => document.querySelector(s);\n  const requestedView = new URLSearchParams(location.search).get('view');\n  if (requestedView === 'plans') document.title = '极客 · 字符套餐';\n  async function finishAuthentication() {\n    if (requestedView === 'plans') { location.reload(); return; }\n    await window.api.subscription.enterApp();\n  }\n",
    'subscription requested view'
  );
  source = replaceOnce(
    source,
    "  $('#back-login').onclick = async () => { await window.api.subscription.logout(); location.reload(); };\n  $('#home-logout').onclick = async () => { await window.api.subscription.logout(); location.reload(); };",
    "  $('#back-login').onclick = async () => { await window.api.subscription.logout(); location.reload(); };",
    'remove legacy home logout handler'
  );
  source = replaceOnce(
    source,
    "      await window.api.subscription.login(email, pass);\n      location.reload();",
    "      await window.api.subscription.login(email, pass);\n      await finishAuthentication();",
    'login direct entry'
  );
  source = replaceOnce(
    source,
    "      await window.api.subscription.register(email, pass);\n      location.reload();",
    "      await window.api.subscription.register(email, pass);\n      await finishAuthentication();",
    'register direct entry'
  );
  source = replaceOnce(
    source,
    "  $('#btn-enter').onclick = () => window.api.subscription.enterApp();\n  $('#btn-open-plans').onclick = () => show('view-plans');\n  $('#btn-close').onclick = () => window.api.subscription.closeWindow();",
    "  $('#btn-close').onclick = () => window.api.subscription.closeWindow();",
    'remove legacy home actions'
  );
  const initStart = "  (async () => {\n    try {\n      let state = await window.api.subscription.getState();";
  const initEnd = "  })();\n</script>";
  const startIndex = source.indexOf(initStart);
  const endIndex = source.indexOf(initEnd, startIndex);
  if (startIndex < 0 || endIndex < 0) throw new Error('Missing subscription startup initializer anchors');
  const replacement = `  (async () => {\n    try {\n      const state = await window.api.subscription.getState();\n      if (!state.loggedIn) { show('view-login'); return; }\n      if (requestedView === 'plans') { show('view-plans'); return; }\n      await window.api.subscription.enterApp();\n    } catch (e) {\n      show('view-login');\n    }\n  })();\n</script>`;
  source = source.slice(0, startIndex) + replacement + source.slice(endIndex + initEnd.length);
  write('ui/subscription.html', source);
}

write('ui/profile-center.js', `(() => {\n  'use strict';\n\n  const api = window.api;\n  const sideNav = document.getElementById('side-nav');\n  if (!api?.subscription || !api?.window || !sideNav) return;\n\n  const make = (tag, className, text) => {\n    const node = document.createElement(tag);\n    if (className) node.className = className;\n    if (text !== undefined) node.textContent = text;\n    return node;\n  };\n\n  const entry = make('button', 'profile-entry');\n  entry.type = 'button';\n  entry.id = 'profile-center-entry';\n  entry.setAttribute('aria-haspopup', 'dialog');\n  entry.setAttribute('aria-expanded', 'false');\n\n  const avatar = make('span', 'profile-entry-avatar', 'G');\n  const entryCopy = make('span', 'profile-entry-copy');\n  const entryTitle = make('strong', '', '个人中心');\n  const entryQuota = make('small', '', '字符余量 —');\n  entryCopy.append(entryTitle, entryQuota);\n  entry.append(avatar, entryCopy);\n  sideNav.appendChild(entry);\n\n  const overlay = make('div', 'profile-center-overlay');\n  overlay.id = 'profile-center-overlay';\n  overlay.hidden = true;\n\n  const dialog = make('section', 'profile-center-dialog');\n  dialog.setAttribute('role', 'dialog');\n  dialog.setAttribute('aria-modal', 'true');\n  dialog.setAttribute('aria-labelledby', 'profile-center-title');\n\n  const head = make('header', 'profile-center-head');\n  const headCopy = make('div', 'profile-center-head-copy');\n  const title = make('h2', '', '个人中心');\n  title.id = 'profile-center-title';\n  headCopy.append(title, make('p', '', '账户、字符余量与购买入口'));\n  const closeButton = make('button', 'profile-center-close', '×');\n  closeButton.type = 'button';\n  closeButton.setAttribute('aria-label', '关闭个人中心');\n  head.append(headCopy, closeButton);\n\n  const body = make('div', 'profile-center-body');\n  const accountCard = make('section', 'profile-center-card');\n  accountCard.append(make('div', 'profile-center-card-title', '账户'));\n  const accountGrid = make('div', 'profile-center-grid');\n  const accountRefLabel = make('span', 'profile-center-label', '账号号');\n  const accountRef = make('strong', 'profile-center-value', '—');\n  accountRef.id = 'profile-center-account-ref';\n  const emailLabel = make('span', 'profile-center-label', '邮箱');\n  const email = make('strong', 'profile-center-value', '—');\n  email.id = 'profile-center-email';\n  accountGrid.append(accountRefLabel, accountRef, emailLabel, email);\n  accountCard.append(accountGrid);\n\n  const quotaCard = make('section', 'profile-center-card profile-center-quota-card');\n  quotaCard.append(make('div', 'profile-center-card-title', '字符余量'));\n  const quotaValue = make('div', 'profile-center-quota-value', '—');\n  quotaValue.id = 'profile-center-quota';\n  const quotaHint = make('p', 'profile-center-quota-hint', '字符只用于翻译；用完不会影响 WhatsApp、Telegram 或 LINE 正常聊天。');\n  const quotaActions = make('div', 'profile-center-actions');\n  const refreshButton = make('button', 'profile-center-btn profile-center-btn--secondary', '刷新余量');\n  refreshButton.type = 'button';\n  const buyButton = make('button', 'profile-center-btn profile-center-btn--primary', '购买字符包');\n  buyButton.type = 'button';\n  quotaActions.append(refreshButton, buyButton);\n  quotaCard.append(quotaValue, quotaHint, quotaActions);\n\n  const status = make('div', 'profile-center-status', '');\n  status.id = 'profile-center-status';\n  status.setAttribute('aria-live', 'polite');\n\n  const footer = make('footer', 'profile-center-footer');\n  const logoutButton = make('button', 'profile-center-link', '退出登录');\n  logoutButton.type = 'button';\n  footer.append(logoutButton);\n\n  body.append(accountCard, quotaCard, status);\n  dialog.append(head, body, footer);\n  overlay.append(dialog);\n  document.body.appendChild(overlay);\n\n  let lastFocus = null;\n  let latestRemaining = null;\n\n  function formatRemaining(value) {\n    if (!Number.isFinite(value)) return '—';\n    return Math.max(0, Math.floor(value)).toLocaleString('zh-CN') + ' 字符';\n  }\n\n  function setStatus(message, state = 'idle') {\n    status.textContent = message || '';\n    status.dataset.state = state;\n  }\n\n  function applySummary(state, quota) {\n    const remainingRaw = Number(quota?.remaining_chars);\n    latestRemaining = Number.isFinite(remainingRaw) ? Math.max(0, remainingRaw) : null;\n    const accountNumber = quota?.account_ref || state?.account_ref || '';\n    const emailValue = state?.email || '';\n\n    accountRef.textContent = accountNumber || '暂不可用';\n    email.textContent = emailValue || '暂不可用';\n    quotaValue.textContent = formatRemaining(latestRemaining);\n    quotaCard.dataset.state = latestRemaining === 0 ? 'empty' : 'ready';\n\n    entryTitle.textContent = emailValue || '个人中心';\n    entryQuota.textContent = latestRemaining == null ? '字符余量 —' : '剩余 ' + formatRemaining(latestRemaining);\n    entry.title = (emailValue || '个人中心') + (latestRemaining == null ? '' : ' · 剩余 ' + formatRemaining(latestRemaining));\n    avatar.textContent = emailValue ? emailValue.trim().charAt(0).toUpperCase() || 'G' : 'G';\n  }\n\n  async function getQuotaWithFallback(force) {\n    try {\n      return await api.subscription.getQuota(force === true);\n    } catch (error) {\n      if (force) return api.subscription.getQuota(false);\n      throw error;\n    }\n  }\n\n  async function loadProfile(force = false) {\n    refreshButton.disabled = true;\n    if (!overlay.hidden) setStatus(force ? '正在刷新字符余量…' : '正在读取账户信息…', 'saving');\n    try {\n      const state = await api.subscription.getState();\n      if (!state?.loggedIn) {\n        entryTitle.textContent = '个人中心';\n        entryQuota.textContent = '未登录';\n        accountRef.textContent = '—';\n        email.textContent = '—';\n        quotaValue.textContent = '—';\n        setStatus('当前未登录', 'error');\n        return;\n      }\n      const quota = await getQuotaWithFallback(force);\n      applySummary(state, quota || {});\n      setStatus(force ? '字符余量已更新' : '', 'success');\n    } catch (error) {\n      if (latestRemaining == null) entryQuota.textContent = '余量暂不可用';\n      setStatus('账户信息暂时无法刷新，请稍后重试', 'error');\n    } finally {\n      refreshButton.disabled = false;\n    }\n  }\n\n  function openProfile() {\n    lastFocus = document.activeElement;\n    overlay.hidden = false;\n    entry.setAttribute('aria-expanded', 'true');\n    closeButton.focus();\n    loadProfile(true);\n  }\n\n  function closeProfile() {\n    overlay.hidden = true;\n    entry.setAttribute('aria-expanded', 'false');\n    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();\n  }\n\n  entry.addEventListener('click', openProfile);\n  closeButton.addEventListener('click', closeProfile);\n  overlay.addEventListener('click', (event) => { if (event.target === overlay) closeProfile(); });\n  document.addEventListener('keydown', (event) => {\n    if (event.key === 'Escape' && !overlay.hidden) {\n      event.preventDefault();\n      event.stopImmediatePropagation();\n      closeProfile();\n    }\n  });\n  refreshButton.addEventListener('click', () => loadProfile(true));\n  buyButton.addEventListener('click', async () => {\n    buyButton.disabled = true;\n    setStatus('正在打开字符套餐…', 'saving');\n    try {\n      await api.subscription.openPlans();\n      closeProfile();\n    } catch (error) {\n      setStatus('暂时无法打开字符套餐，请稍后重试', 'error');\n    } finally {\n      buyButton.disabled = false;\n    }\n  });\n  logoutButton.addEventListener('click', async () => {\n    if (!window.confirm('退出当前极客账号？退出后需要重新登录。')) return;\n    logoutButton.disabled = true;\n    setStatus('正在退出登录…', 'saving');\n    try {\n      await api.subscription.logout();\n      await api.window.relaunch();\n    } catch (error) {\n      logoutButton.disabled = false;\n      setStatus('退出登录失败，请稍后重试', 'error');\n    }\n  });\n\n  window.addEventListener('focus', () => loadProfile(false));\n  loadProfile(false);\n})();\n`);

write('ui/profile-center.css', `.profile-entry {\n  width: 100%;\n  border: 1px solid var(--border-subtle);\n  border-radius: var(--radius-md);\n  background: var(--card-bg);\n  color: var(--text-primary);\n  display: flex;\n  align-items: center;\n  gap: 9px;\n  padding: 8px 9px;\n  margin-top: 10px;\n  cursor: pointer;\n  text-align: left;\n  flex-shrink: 0;\n  transition: background .12s ease, border-color .12s ease;\n}\n.profile-entry:hover { background: var(--hover-bg); border-color: var(--border-standard); }\n.profile-entry-avatar {\n  width: 30px; height: 30px; border-radius: 50%;\n  display: inline-flex; align-items: center; justify-content: center;\n  flex-shrink: 0;\n  background: var(--accent-soft); border: 1px solid var(--accent-border);\n  color: var(--accent); font-size: 12px; font-weight: 700;\n}\n.profile-entry-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }\n.profile-entry-copy strong { font-size: 12px; font-weight: 590; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.profile-entry-copy small { font-size: 10px; color: var(--text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.side-nav.collapsed .profile-entry { width: 40px; padding: 4px; justify-content: center; align-self: center; }\n.side-nav.collapsed .profile-entry-copy { display: none; }\n\n.profile-center-overlay {\n  position: fixed; inset: 0; z-index: 5000;\n  display: flex; align-items: center; justify-content: center;\n  padding: 24px; background: rgba(0,0,0,.55);\n  backdrop-filter: blur(5px);\n}\n.profile-center-overlay[hidden] { display: none; }\n.profile-center-dialog {\n  width: min(520px, calc(100vw - 48px)); max-height: min(720px, calc(100vh - 48px));\n  overflow: auto; background: var(--bg-panel); color: var(--text-primary);\n  border: 1px solid var(--border-standard); border-radius: 16px;\n  box-shadow: 0 24px 80px rgba(0,0,0,.45);\n}\n.profile-center-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 20px 22px 16px; border-bottom: 1px solid var(--border-subtle); }\n.profile-center-head-copy h2 { font-size: 18px; font-weight: 620; margin: 0; }\n.profile-center-head-copy p { font-size: 12px; color: var(--text-tertiary); margin-top: 5px; }\n.profile-center-close { width: 30px; height: 30px; border: 0; border-radius: 8px; background: transparent; color: var(--text-tertiary); font-size: 22px; line-height: 1; cursor: pointer; }\n.profile-center-close:hover { background: var(--hover-bg); color: var(--text-primary); }\n.profile-center-body { display: grid; gap: 12px; padding: 16px 22px; }\n.profile-center-card { padding: 16px; border-radius: 12px; border: 1px solid var(--border-subtle); background: var(--card-bg); }\n.profile-center-card-title { color: var(--text-tertiary); font-size: 11px; font-weight: 600; letter-spacing: .4px; margin-bottom: 12px; }\n.profile-center-grid { display: grid; grid-template-columns: 90px minmax(0,1fr); gap: 10px 14px; align-items: baseline; }\n.profile-center-label { color: var(--text-tertiary); font-size: 12px; }\n.profile-center-value { min-width: 0; color: var(--text-primary); font-size: 13px; font-weight: 550; overflow-wrap: anywhere; }\n.profile-center-quota-value { font-size: 30px; line-height: 1.15; font-weight: 680; letter-spacing: -.8px; margin: 2px 0 8px; }\n.profile-center-quota-card[data-state='empty'] .profile-center-quota-value { color: var(--danger); }\n.profile-center-quota-hint { font-size: 12px; line-height: 1.6; color: var(--text-tertiary); }\n.profile-center-actions { display: flex; gap: 8px; margin-top: 14px; }\n.profile-center-btn { border-radius: 8px; padding: 8px 13px; font-size: 12px; font-weight: 580; cursor: pointer; }\n.profile-center-btn:disabled { opacity: .55; cursor: default; }\n.profile-center-btn--primary { border: 1px solid var(--accent-border); background: var(--accent); color: #06230f; }\n.profile-center-btn--secondary { border: 1px solid var(--border-standard); background: var(--btn-bg); color: var(--text-secondary); }\n.profile-center-status { min-height: 18px; font-size: 11px; color: var(--text-tertiary); padding: 0 2px; }\n.profile-center-status[data-state='error'] { color: var(--danger); }\n.profile-center-status[data-state='success'] { color: var(--accent); }\n.profile-center-footer { display: flex; justify-content: flex-end; padding: 12px 22px 18px; border-top: 1px solid var(--border-subtle); }\n.profile-center-link { border: 0; background: transparent; color: var(--text-tertiary); font-size: 12px; cursor: pointer; padding: 6px 0; }\n.profile-center-link:hover { color: var(--danger); }\n`);

write('test/profile-center-ux-contract.cjs', `'use strict';\n\nconst assert = require('node:assert/strict');\nconst fs = require('node:fs');\nconst path = require('node:path');\n\nconst root = path.join(__dirname, '..');\nconst read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');\n\nconst index = read('ui/index.html');\nconst profile = read('ui/profile-center.js');\nconst css = read('ui/profile-center.css');\nconst subscription = read('ui/subscription.html');\nconst preload = read('src/preload.cjs');\nconst main = read('src/main.cjs');\nconst pkg = JSON.parse(read('package.json'));\nconst marker = read('.github/release-client-version').trim();\n\nassert.match(index, /profile-center\\.css/, '主窗口必须加载个人中心样式');\nassert.match(index, /profile-center\\.js/, '主窗口必须加载个人中心模块');\nassert.match(profile, /profile-center-entry/, '左侧栏必须有个人中心入口');\nassert.match(profile, /字符余量/, '个人中心入口与面板必须保留字符余量展示');\nassert.match(profile, /subscription\\.getState\\(\\)/, '个人中心必须读取当前账号状态');\nassert.match(profile, /subscription\\.getQuota\\(force === true\\)/, '个人中心刷新必须复用现有 quota API');\nassert.match(profile, /subscription\\.openPlans\\(\\)/, '购买按钮必须复用现有套餐窗口');\nassert.match(profile, /subscription\\.logout\\(\\)/, '个人中心必须保留退出登录能力');\nassert.match(profile, /window\\.relaunch\\(\\)/, '退出登录后必须回到登录门禁流程');\nassert.match(css, /side-nav\\.collapsed \\.profile-entry-copy/, '折叠侧栏必须保持个人中心入口可访问');\nassert.doesNotMatch(subscription, /id=\\"view-home\\"/, '登录后不应再存在余额购买中间首页');\nassert.match(subscription, /finishAuthentication/, '登录与注册成功必须统一进入工作区');\nassert.match(subscription, /requestedView === 'plans'/, '套餐窗口必须支持个人中心直达');\nassert.match(subscription, /await window\\.api\\.subscription\\.enterApp\\(\\)/, '普通登录成功必须直接进入主窗口');\nassert.match(preload, /openPlans: \\(\\) => invokeSubscription\\('subscription:open-plans'\\)/, 'preload 必须只暴露受控套餐入口');\nassert.match(main, /function createSubscriptionWindow\\(initialView = ''\\)/, '订阅窗口必须支持受控初始视图');\nassert.match(main, /query: \\{ view: initialView \\}/, '套餐直达必须通过本地 file query 传递');\nassert.match(main, /ipcMain\\.handle\\('subscription:open-plans'/, '主进程必须注册套餐窗口 IPC');\nassert.match(main, /createSubscriptionWindow\\(state\\.loggedIn \\? 'plans' : ''\\)/, '未登录时套餐入口必须回退到登录窗口');\nassert.equal(pkg.version, '1.2.12', '普通 UX 维护不得修改客户端版本');\nassert.equal(marker, '1.2.12', '普通 UX 维护不得触发客户端发布');\n\nconsole.log('PROFILE_CENTER_UX_CONTRACT_OK');\n`);

console.log('PROFILE_CENTER_PATCH_OK');

import { serialQueue, errorMessage, filterAccounts, archiveAccount } from './model.mjs';

const $ = (id) => document.getElementById(id);
const enqueue = serialQueue();
const invoke = window.__TAURI__?.core?.invoke;
let current = null;
let busy = false;
let editingId = null;
let renderedEditorId = null;
let layoutPending = false;
let layoutDirty = false;

function syncWebsiteForm() {
  const website = $('platform').value === 'website';
  $('website-field').hidden = !website;
  $('website-url').required = website;
  $('website-url').disabled = busy || !current || !website;
}

function setBusy(value) {
  busy = value;
  for (const element of document.querySelectorAll('button, input, select')) {
    element.disabled = value || !current || element.dataset.unavailable === 'true';
  }
  $('reload').disabled = value || !current?.activeId;
  $('close').disabled = value || !current?.activeId;
  $('retry').disabled = value || !invoke;
  syncWebsiteForm();
}

function renderEditor() {
  const account = current?.accounts.find((a) => a.id === editingId);
  $('editor').hidden = !account;
  if (!account) { editingId = null; renderedEditorId = null; return; }
  if (renderedEditorId !== editingId) {
    $('edit-name').value = account.name;
    renderedEditorId = editingId;
  }
  $('editor-title').textContent = `管理：${account.name}`;
  $('archive').textContent = account.archived ? '恢复到账号列表' : '归档（保留登录数据）';
  $('archive-note').textContent = account.archived
    ? '恢复只改变归档状态，不自动打开网页。'
    : '归档会先关闭页面，停止该账号接收消息。登录数据保留，可随时恢复。';
}

function editAccount(id) {
  if (busy) return;
  editingId = id;
  renderedEditorId = null;
  renderEditor();
  $('editor').scrollIntoView({ block: 'nearest' });
  $('edit-name').focus();
}

function renderAccounts() {
  if (!current) return;
  const accounts = filterAccounts(current.accounts, current.platforms,
    $('search').value, $('archived-only').checked);
  $('accounts').replaceChildren();
  for (const account of accounts) {
    const row = document.createElement('div');
    row.className = 'account-row';
    const button = document.createElement('button');
    button.className = 'account';
    button.type = 'button';
    button.dataset.unavailable = String(Boolean(account.archived));
    button.setAttribute('aria-pressed', String(account.id === current.activeId));
    const title = document.createElement('strong');
    title.textContent = account.name;
    const detail = document.createElement('small');
    const platform = current.platforms.find((p) => p.id === account.platformId);
    const state = account.archived ? '已归档' : current.openedIds.includes(account.id) ? '已打开' : '未打开';
    detail.textContent = `${platform?.name || account.platformId} · ${state}`;
    button.append(title, detail);
    button.addEventListener('click', () => run(() => invoke('account_activate', { id: account.id })));
    const manage = document.createElement('button');
    manage.type = 'button';
    manage.className = 'manage';
    manage.textContent = '管理';
    manage.setAttribute('aria-label', `管理账号 ${account.name}`);
    manage.addEventListener('click', () => editAccount(account.id));
    row.append(button, manage);
    $('accounts').append(row);
  }
  $('list-empty').hidden = accounts.length > 0;
  $('account-count').textContent = `${accounts.length} / ${current.accounts.length}`;
  setBusy(busy);
}

function render(next) {
  const first = !current;
  current = next;
  const selected = $('platform').value;
  $('platform').replaceChildren();
  for (const platform of next.platforms) {
    const option = document.createElement('option');
    option.value = platform.id;
    option.textContent = platform.name + (platform.enabled ? '' : ' · 暂未接入');
    option.disabled = !platform.enabled;
    $('platform').append(option);
  }
  if (next.platforms.some((p) => p.id === selected && p.enabled)) $('platform').value = selected;
  if (first && !next.accounts.length) $('add-panel').open = true;
  const active = next.accounts.find((a) => a.id === next.activeId);
  $('active-title').textContent = active?.name || '请选择账号';
  $('empty').hidden = Boolean(active);
  $('close-to-tray').checked = next.settings.closeToTray;
  $('tray-note').textContent = next.trayAvailable
    ? '托盘左键恢复窗口；右键菜单可完全退出。后台收消息仍待真机验收。'
    : '系统托盘不可用：关闭窗口将退出应用。';
  renderAccounts();
  renderEditor();
  setBusy(busy);
}

function run(operation) {
  if (busy || !invoke) return;
  setBusy(true);
  $('status').textContent = '正在处理…';
  enqueue(async () => {
    try {
      const next = await operation();
      if (next) render(next);
      $('status').textContent = '就绪 · 已打开不等于已登录；归档不会删除登录数据';
    } catch (error) {
      try { render(await invoke('desktop_snapshot')); } catch { /* retain last known state */ }
      $('status').textContent = errorMessage(typeof error === 'string' ? error : 'UNKNOWN');
    } finally {
      setBusy(false);
    }
  });
}

$('platform').addEventListener('change', syncWebsiteForm);
$('search').addEventListener('input', renderAccounts);
$('archived-only').addEventListener('change', renderAccounts);
$('retry').addEventListener('click', () => run(() => invoke('desktop_snapshot')));
$('create-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('name').value.trim();
  const platformId = $('platform').value;
  const websiteUrl = platformId === 'website' ? $('website-url').value.trim() : null;
  if (!name) { $('name').focus(); return; }
  run(async () => {
    const next = await invoke('account_create', { name, platformId, websiteUrl });
    $('search').value = '';
    $('archived-only').checked = false;
    $('name').value = '';
    $('website-url').value = '';
    $('add-panel').open = false;
    render(next);
    return invoke('account_activate', { id: next.accounts.at(-1).id });
  });
});
$('edit-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const id = editingId;
  const name = $('edit-name').value.trim();
  if (id && name) run(async () => {
    const next = await invoke('account_rename', { id, name });
    renderedEditorId = null;
    return next;
  });
});
$('edit-cancel').addEventListener('click', () => { editingId = null; renderEditor(); });
$('archive').addEventListener('click', () => {
  const account = current?.accounts.find((a) => a.id === editingId);
  if (!account) return;
  const id = account.id;
  run(async () => {
    const next = account.archived
      ? await invoke('account_set_archived', { id, archived: false })
      : await archiveAccount(invoke, id);
    editingId = null;
    return next;
  });
});
$('close-to-tray').addEventListener('change', () => {
  const closeToTray = $('close-to-tray').checked;
  run(() => invoke('desktop_settings', { settings: { closeToTray } }));
});
$('reload').addEventListener('click', () => {
  const id = current?.activeId;
  if (id) run(() => invoke('account_reload', { id }));
});
$('close').addEventListener('click', () => {
  const id = current?.activeId;
  if (id) run(() => invoke('account_close', { id }));
});

function requestLayout() {
  if (!invoke || !current) return;
  layoutDirty = true;
  if (layoutPending) return;
  layoutPending = true;
  enqueue(async () => {
    try {
      while (layoutDirty) {
        layoutDirty = false;
        await invoke('desktop_layout');
      }
    } catch {
      $('status').textContent = '页面布局更新失败，请重新选择账号。';
    } finally { layoutPending = false; }
  });
}
window.addEventListener('resize', requestLayout);
if (invoke) {
  run(() => invoke('desktop_snapshot'));
} else {
  setBusy(false);
  $('status').textContent = '请通过 Windows Tauri 客户端启动；浏览器预览不会模拟账号操作。';
}

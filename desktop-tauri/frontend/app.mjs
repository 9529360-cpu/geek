import { serialQueue, errorMessage } from './model.mjs';

const $ = (id) => document.getElementById(id);
const enqueue = serialQueue();
const invoke = window.__TAURI__?.core?.invoke;
let current = null;
let busy = false;
let layoutPending = false;
let layoutDirty = false;

function setBusy(value) {
  busy = value;
  for (const element of document.querySelectorAll('button, input, select')) element.disabled = value || !current;
  $('reload').disabled = value || !current?.activeId;
  $('close').disabled = value || !current?.activeId;
}

function render(next) {
  current = next;
  const selected = $('platform').value;
  $('platform').replaceChildren();
  for (const platform of next.platforms) {
    const option = document.createElement('option');
    option.value = platform.id;
    option.textContent = platform.name + (platform.enabled ? '' : ' · 尚未适配');
    option.disabled = !platform.enabled;
    $('platform').append(option);
  }
  if (next.platforms.some((p) => p.id === selected && p.enabled)) $('platform').value = selected;
  $('accounts').replaceChildren();
  for (const account of next.accounts) {
    const button = document.createElement('button');
    button.className = 'account';
    button.type = 'button';
    button.setAttribute('aria-pressed', String(account.id === next.activeId));
    const title = document.createElement('strong');
    title.textContent = account.name;
    const detail = document.createElement('small');
    const platform = next.platforms.find((p) => p.id === account.platformId);
    detail.textContent = `${platform?.name || account.platformId} · ${next.openedIds.includes(account.id) ? '已打开' : '未打开'}`;
    button.append(title, detail);
    button.addEventListener('click', () => run(() => invoke('account_activate', { id: account.id })));
    $('accounts').append(button);
  }
  const active = next.accounts.find((a) => a.id === next.activeId);
  $('active-title').textContent = active?.name || '请选择账号';
  $('empty').hidden = Boolean(active);
  $('account-count').textContent = String(next.accounts.length);
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
      $('status').textContent = '就绪 · 已打开不等于已登录；后台收消息待实测';
    } catch (error) {
      // Refresh after partially successful operations; do not display raw native errors.
      try { render(await invoke('desktop_snapshot')); } catch { /* keep last known state */ }
      $('status').textContent = errorMessage(typeof error === 'string' ? error : 'UNKNOWN');
    } finally {
      setBusy(false);
    }
  });
}

$('create-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $('name').value.trim();
  const platformId = $('platform').value;
  if (!name) { $('name').focus(); return; }
  run(async () => {
    const next = await invoke('account_create', { name, platformId });
    render(next);
    $('name').value = '';
    return invoke('account_activate', { id: next.accounts.at(-1).id });
  });
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
  $('status').textContent = '请通过 Windows Tauri 客户端启动；浏览器预览不会模拟账号操作。';
}

import { filterAccounts } from './model.mjs';

// DOM-only view: no native commands, persistence, or business transactions.
export function createShellView(document) {
  const $ = (id) => document.getElementById(id);
  function syncWebsiteForm(current, busy) {
    const website = $('platform').value === 'website';
    $('website-field').hidden = !website;
    $('website-url').required = website;
    $('website-url').disabled = busy || !current || !website;
  }

  function renderEditor(account, resetName) {
    $('editor').hidden = !account;
    if (!account) return;
    if (resetName) {
      $('edit-name').value = account.name;
    }
    $('editor-title').textContent = `管理：${account.name}`;
    $('archive').textContent = account.archived ? '恢复到账号列表' : '归档（保留登录数据）';
    $('archive-note').textContent = account.archived
      ? '恢复只改变归档状态，不自动打开网页。'
      : '归档会先关闭页面，停止该账号接收消息。登录数据保留，可随时恢复。';
  }

  function renderAccounts(current, onActivate, onManage) {
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
      button.addEventListener('click', () => onActivate(account.id));
      const manage = document.createElement('button');
      manage.type = 'button';
      manage.className = 'manage';
      manage.textContent = '管理';
      manage.setAttribute('aria-label', `管理账号 ${account.name}`);
      manage.addEventListener('click', () => onManage(account.id));
      row.append(button, manage);
      $('accounts').append(row);
    }
    $('list-empty').hidden = accounts.length > 0;
    $('account-count').textContent = `${accounts.length} / ${current.accounts.length}`;
  }

  function renderSnapshot(next, first) {
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
  }

  function setBusy(current, value, available) {
    for (const element of document.querySelectorAll('button, input, select')) {
      element.disabled = value || !current || element.dataset.unavailable === 'true';
    }
    $('reload').disabled = value || !current?.activeId;
    $('close').disabled = value || !current?.activeId;
    $('retry').disabled = value || !available;
    syncWebsiteForm(current, value);
  }

  return Object.freeze({ $, syncWebsiteForm, setBusy, renderEditor, renderAccounts, renderSnapshot });
}

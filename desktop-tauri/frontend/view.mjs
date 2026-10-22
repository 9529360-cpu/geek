import { createAccountView } from './views/accounts.mjs';
import { proxyFromFields } from './models/proxy.mjs';

export function createShellView(document) {
  const $ = (id) => document.getElementById(id);
  const accounts = createAccountView(document);
  const wire = (id) => { $(id).dataset.wired = 'true'; return $(id); };
  const on = (id, event, action) => wire(id).addEventListener(event, action);
  $('settings-global').append($('runtime-settings-template').content.cloneNode(true));
  $('add-status').before($('create-proxy-template').content.cloneNode(true));
  const runtimeStatus = $('runtime-status');
  let connected = false;
  $('side-nav').append(runtimeStatus);
  $('nav-version').textContent = 'Tauri \u5f00\u53d1\u7248';
  $('settings-account-email').textContent = '\u8ba4\u8bc1\u5c1a\u672a\u8fc1\u79fb';
  $('settings-account-quota').textContent = '\u8ba2\u9605\u5c1a\u672a\u8fc1\u79fb';
  $('add-count').value = '1';
  $('add-count').title = '1–10 个；整批保存成功后只打开第一个账号';
  $('account-settings-name').maxLength = 64;
  const pending = ['btn-restart', 'btn-lock', 'btn-contact-notes', 'btn-translation', 'btn-broadcast'];
  for (const id of pending) {
    $(id).title += ' \u00b7 \u5c1a\u672a\u8fc1\u79fb';
    $(id).setAttribute('aria-label', $(id).title);
  }
  for (const id of ['add-count', 'add-name', 'add-custom-url', 'account-settings-name', 'proxy-openProxy',
    'proxy-protocal', 'proxy-host', 'proxy-port', 'close-to-tray', 'search', 'archived-only',
    'create-proxy-mode', 'create-proxy-host', 'create-proxy-port']) wire(id);
  for (const option of $('proxy-protocal').options) option.disabled = !['http', 'socks5'].includes(option.value);
  $('proxy-user').placeholder = '\u4ee3\u7406\u8ba4\u8bc1\u5c1a\u672a\u8fc1\u79fb';
  $('proxy-pwd').placeholder = '\u4ee3\u7406\u8ba4\u8bc1\u5c1a\u672a\u8fc1\u79fb';
  const note = document.createElement('p');
  note.className = 'runtime-note';
  note.textContent = '\u4fdd\u7559\u539f\u754c\u9762\uff1b\u7070\u8272\u529f\u80fd\u5c1a\u672a\u8fc1\u79fb\u3002\u4e0d\u8bfb\u5199 Electron \u8d26\u53f7\u6570\u636e\u3002';
  $('runtime-settings').append(note);
  const proxyNote = note.cloneNode(true);
  proxyNote.textContent = '\u4ec5\u652f\u6301\u65e0\u8ba4\u8bc1 HTTP / SOCKS5\u3002\u4fee\u6539\u540e\u5173\u95ed\u6b64\u8d26\u53f7\uff0c\u4e0d\u81ea\u52a8\u91cd\u8fde\u3002';
  $('proxy-host').closest('.add-form').append(proxyNote);
  const archive = accounts.button('btn-plain', '\u5f52\u6863\uff08\u4fdd\u7559\u767b\u5f55\u6570\u636e\uff09', () => {});
  archive.id = 'archive';
  archive.textContent = '\u5f52\u6863\uff08\u4fdd\u7559\u767b\u5f55\u6570\u636e\uff09';
  $('account-settings-cancel').before(archive);

  function busy(value, available, nativeAvailable) {
    connected = nativeAvailable;
    for (const element of document.querySelectorAll('button, input, select, textarea')) {
      element.disabled = value || !available || element.dataset.wired !== 'true' || element.dataset.unavailable === 'true';
    }
    // Frameless window recovery must not depend on a successful account snapshot.
    for (const id of ['btn-win-min', 'btn-win-max', 'btn-win-close', 'runtime-retry']) {
      $(id).disabled = value || !connected;
    }
    $('runtime-retry').hidden = !connected || !$('runtime-status-message').textContent;
    for (const id of ['create-proxy-host', 'create-proxy-port']) {
      $(id).disabled ||= $('create-proxy-mode').value === 'system';
    }
    for (const id of ['proxy-protocal', 'proxy-host', 'proxy-port']) $(id).disabled ||= !$('proxy-openProxy').checked;
  }
  function status(message = '') {
    $('runtime-status-message').textContent = message;
    runtimeStatus.classList.toggle('hidden', !message);
    $('runtime-retry').hidden = !connected || !message;
    for (const id of ['add-status', 'account-settings-status', 'settings-status']) {
      if ($(id)) $(id).textContent = message;
    }
  }
  function statusPanel(id) {
    // Keep recovery inside the current modal's keyboard focus boundary.
    const target = id ? (id === 'ctx-menu' ? $(id) : $(id).firstElementChild) : $('side-nav');
    target.append(runtimeStatus);
    runtimeStatus.classList.toggle('in-dialog', Boolean(id));
  }
  function editor(account) {
    $('account-settings-target').textContent = account.name;
    $('account-settings-name').value = account.name;
  }
  function proxy(account) {
    $('proxy-openProxy').checked = account.proxy?.mode !== 'system' && Boolean(account.proxy);
    $('proxy-protocal').value = account.proxy?.mode === 'socks5' ? 'socks5' : 'http';
    $('proxy-host').value = account.proxy?.host || '';
    $('proxy-port').value = account.proxy?.port || '';
  }
  function readProxy(creating = false) {
    return creating
      ? proxyFromFields($('create-proxy-mode').value, $('create-proxy-host').value, $('create-proxy-port').value)
      : proxyFromFields($('proxy-openProxy').checked ? $('proxy-protocal').value : 'system', $('proxy-host').value, $('proxy-port').value);
  }
  function settings(snapshot) {
    $('close-to-tray').checked = snapshot.settings.closeToTray;
    $('tray-note').textContent = snapshot.trayAvailable
      ? '\u6258\u76d8\u53f3\u952e\u83dc\u5355\u53ef\u5b8c\u5168\u9000\u51fa\u3002'
      : '\u6258\u76d8\u4e0d\u53ef\u7528\uff0c\u5173\u95ed\u7a97\u53e3\u5c06\u9000\u51fa\u5e94\u7528\u3002';
  }
  return { $, on, wire, accounts, busy, status, statusPanel, editor, proxy, readProxy, settings };
}

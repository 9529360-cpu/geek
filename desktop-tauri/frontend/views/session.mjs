import { sessionStatus } from '../models/translation.mjs';

export function createSessionView(document, actions) {
  const $ = (id) => document.getElementById(id);
  const dialog = $('session-dialog');
  const listeners = [];
  const bind = (id, event, action) => {
    const node = $(id);
    node.dataset.wired = 'true';
    node.addEventListener(event, action);
    listeners.push(() => node.removeEventListener(event, action));
    return node;
  };
  const button = (id, text, handler) => {
    const node = document.createElement('button');
    node.type = 'button'; node.id = id; node.className = 'btn-plain'; node.textContent = text;
    node.dataset.wired = 'true'; node.addEventListener('click', handler);
    return node;
  };
  const controls = document.createElement('div');
  controls.className = 'session-account-actions';
  controls.append(button('settings-session-open', '登录极客账户', actions.open),
    button('settings-session-refresh', '刷新余额', actions.refresh));
  const status = document.createElement('div');
  status.id = 'settings-session-status'; status.className = 'session-account-status';
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  $('settings-personal-center').append(controls, status);
  $('settings-personal-center').querySelector('.settings-card-sub').textContent = '管理极客登录账户；翻译字符余额以服务端为准。';
  const refresh = button('session-refresh', '刷新余额', actions.refresh);
  refresh.className = 'session-text-link';
  $('session-home-logout').before(refresh);
  for (const id of ['session-in-email', 'session-in-pass']) {
    $(id).dataset.wired = 'true';
    $(id).setAttribute('aria-label', id.endsWith('email') ? '邮箱' : '密码');
    bind(id, 'keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); actions.login(); } });
  }
  $('session-in-email').maxLength = 320;
  $('session-in-pass').maxLength = 128;
  $('session-view-login').querySelector('.hint').textContent = '登录极客账户后使用消息翻译';
  for (const id of ['session-go-register', 'session-btn-register', 'session-btn-open-plans', 'session-btn-buy',
    'session-btn-refresh-status', 'session-back-login', 'session-go-login']) {
    const node = $(id);
    node.disabled = true; node.dataset.unavailable = 'true'; node.title = '此功能尚未迁移';
    if (id === 'session-go-register') node.textContent = '注册（尚未迁移）';
    if (id === 'session-btn-open-plans') node.textContent = '购买字符包（尚未迁移）';
  }
  bind('session-btn-login', 'click', actions.login);
  bind('session-home-logout', 'click', actions.logout);
  bind('session-btn-close', 'click', actions.close);
  bind('session-btn-enter', 'click', actions.close).textContent = '返回极客';
  $('session-login-err').setAttribute('role', 'alert');
  $('session-home-logout-err').setAttribute('role', 'alert');

  function render(snapshot, { pending = '', error = '', shellBusy = false, connected = false } = {}) {
    const signedIn = snapshot?.state === 'signedIn';
    const state = sessionStatus(snapshot, error);
    $('settings-account-email').textContent = signedIn ? snapshot.user.email : '未登录';
    $('settings-account-quota').textContent = state.quota;
    $('settings-session-status').textContent = state.detail;
    $('settings-session-open').textContent = signedIn ? '管理极客账户' : '登录极客账户';
    $('settings-session-open').disabled = !connected || shellBusy;
    $('settings-session-refresh').disabled = !connected || shellBusy || Boolean(pending) || !signedIn;
    for (const node of dialog.querySelectorAll('input, button')) {
      node.disabled = !connected || shellBusy || node.dataset.wired !== 'true'
        || node.dataset.unavailable === 'true' || Boolean(pending);
    }
    // A login/network operation does not prevent closing this dialog or the window.
    for (const id of ['session-btn-close', 'session-btn-enter']) $(id).disabled = shellBusy || !connected;
    $('session-view-login').classList.toggle('on', !signedIn);
    $('session-view-home').classList.toggle('on', signedIn);
    $('session-btn-login').textContent = pending === 'login' ? '登录中…' : '登 录';
    $('session-home-logout').textContent = pending === 'logout' ? '退出中…' : '退出登录';
    $('session-login-err').textContent = !signedIn ? error : '';
    $('session-home-logout-err').textContent = signedIn ? error : '';
    $('session-service-health').dataset.state = state.kind === 'ok' ? 'ok' : state.kind === 'error' ? 'error' : 'idle';
    $('session-service-health').textContent = pending === 'refresh' ? '正在检查登录和余额…' : `账户状态 · ${state.label}`;
    if (signedIn) {
      $('session-home-icon').textContent = state.kind === 'ok' ? '✓' : '⚠️';
      $('session-home-title').textContent = state.label;
      $('session-home-email').textContent = snapshot.user.email;
      $('session-home-account-ref').textContent = snapshot.user.accountNo ? `账号号 ${snapshot.user.accountNo}` : '账号号暂不可用';
      $('session-home-quota').textContent = state.quota;
      $('session-home-quota').classList.toggle('expired', state.kind === 'error');
      $('session-home-sub').textContent = state.kind === 'ok' ? '翻译按实际使用扣减字符，余额以服务端为准。' : state.detail;
    }
  }
  return { render,
    credentials: () => ({ email: $('session-in-email').value.trim(), password: $('session-in-pass').value }),
    clearPassword: () => { $('session-in-pass').value = ''; },
    dispose: () => listeners.forEach((remove) => remove()),
  };
}

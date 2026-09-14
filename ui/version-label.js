(() => {
  'use strict';

  // This script is the existing lightweight shell bootstrap slot. Keep shell UX
  // owners separate from app.js so accessibility never becomes another source of
  // account/WebView business state.
  const canBootstrapShell = typeof document.querySelector === 'function' && typeof document.createElement === 'function' && document.head?.appendChild;
  function ensureStyle(href, marker) {
    if (!canBootstrapShell || document.querySelector(`link[${marker}]`)) return;
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = href;
    style.setAttribute(marker, 'true');
    document.head.appendChild(style);
  }
  function ensureScript(src, marker) {
    if (!canBootstrapShell || document.querySelector(`script[${marker}]`)) return;
    const script = document.createElement('script');
    script.src = src;
    script.setAttribute(marker, 'true');
    document.head.appendChild(script);
  }

  ensureStyle('./shell-accessibility.css', 'data-geek-shell-accessibility');
  ensureScript('./shell-accessibility.js', 'data-geek-shell-accessibility');
  ensureStyle('./account-context-accessibility.css', 'data-geek-account-context-accessibility');
  ensureScript('./account-context-accessibility.js', 'data-geek-account-context-accessibility');
  ensureStyle('./lock-screen-accessibility.css', 'data-geek-lock-screen-accessibility');
  ensureScript('./lock-screen-accessibility.js', 'data-geek-lock-screen-accessibility');
  ensureScript('./lock-screen-entry.js', 'data-geek-lock-screen-entry');
  ensureStyle('./proxy-dialog-accessibility.css', 'data-geek-proxy-dialog-accessibility');
  ensureScript('./proxy-dialog-accessibility.js', 'data-geek-proxy-dialog-accessibility');
  ensureStyle('./first-run-onboarding.css', 'data-geek-first-run-onboarding');
  ensureScript('./first-run-onboarding.js', 'data-geek-first-run-onboarding');
  ensureScript('./webview-crash-feedback.js', 'data-geek-webview-crash-feedback');

  const label = document.getElementById('nav-version');
  if (!label) return;

  const render = (value) => {
    const version = String(value || '').trim();
    const valid = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version);
    label.textContent = valid ? 'v' + version : 'v—';
  };

  const getVersion = window.api?.app?.version;
  if (typeof getVersion !== 'function') {
    render('');
    return;
  }

  Promise.resolve()
    .then(() => getVersion())
    .then(render)
    .catch(() => render(''));
})();

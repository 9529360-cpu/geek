(() => {
  'use strict';

  // This script is the existing lightweight shell bootstrap slot. Keep the
  // accessibility owner separate from app.js so shell semantics never become
  // another source of account/WebView state.
  const canBootstrapShell = typeof document.querySelector === 'function' && typeof document.createElement === 'function' && document.head?.appendChild;
  if (canBootstrapShell && !document.querySelector('link[data-geek-shell-accessibility]')) {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = './shell-accessibility.css';
    style.dataset.geekShellAccessibility = 'true';
    document.head.appendChild(style);
  }
  if (canBootstrapShell && !document.querySelector('script[data-geek-shell-accessibility]')) {
    const script = document.createElement('script');
    script.src = './shell-accessibility.js';
    script.dataset.geekShellAccessibility = 'true';
    document.head.appendChild(script);
  }

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

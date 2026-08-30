(() => {
  'use strict';

  const label = document.getElementById('nav-version');
  if (label) {
    const render = (value) => {
      const version = String(value || '').trim();
      const valid = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version);
      label.textContent = valid ? 'v' + version : 'v—';
    };

    const getVersion = window.api?.app?.version;
    if (typeof getVersion !== 'function') render('');
    else {
      Promise.resolve()
        .then(() => getVersion())
        .then(render)
        .catch(() => render(''));
    }
  }

  const simplifyAccountContextMenu = () => {
    const menu = document.getElementById('ctx-menu');
    const proxy = menu?.querySelector('.ctx-item[data-act="proxy"]');
    proxy?.remove();
  };
  const menu = document.getElementById('ctx-menu');
  if (menu) new MutationObserver(simplifyAccountContextMenu).observe(menu, { childList: true, subtree: true });

  if (!document.querySelector('script[data-geek-account-center]')) {
    const script = document.createElement('script');
    script.src = './account-center.js';
    script.dataset.geekAccountCenter = 'true';
    document.head.appendChild(script);
  }
})();

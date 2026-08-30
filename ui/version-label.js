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

  // The runtime-version contract intentionally executes this module with a minimal
  // fake DOM. Keep version rendering independent from the optional real-browser UI
  // enhancements below.
  if (typeof document.querySelector !== 'function' ||
      typeof document.createElement !== 'function' ||
      !document.head) return;

  if (!document.querySelector('script[data-geek-account-center]')) {
    const script = document.createElement('script');
    script.src = './account-center.js';
    script.dataset.geekAccountCenter = 'true';
    document.head.appendChild(script);
  }
})();

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

  if (!document.querySelector('script[data-geek-account-center]')) {
    const script = document.createElement('script');
    script.src = './account-center.js';
    script.dataset.geekAccountCenter = 'true';
    document.head.appendChild(script);
  }
})();

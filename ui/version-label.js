(() => {
  'use strict';

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

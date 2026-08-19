(() => {
  'use strict';

  const label = document.getElementById('nav-version');
  if (!label) return;

  const version = String(window.api?.app?.version || '').trim();
  const valid = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version);
  label.textContent = valid ? 'v' + version : 'v—';
})();

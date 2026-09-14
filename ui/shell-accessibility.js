(() => {
  'use strict';

  const PLATFORM_SELECTOR = '.tab-item[data-platform]';
  const ACCOUNT_SELECTOR = '.nav-account[data-id] .nav-account-main';
  let pendingFocus = null;

  function setAttrIfChanged(node, name, value) {
    if (!node) return;
    const next = String(value);
    if (node.getAttribute(name) !== next) node.setAttribute(name, next);
  }

  function removeAttrIfPresent(node, name) {
    if (node?.hasAttribute(name)) node.removeAttribute(name);
  }

  function platformKey(node) {
    return String(node?.dataset?.platform || '');
  }

  function accountKey(node) {
    return String(node?.closest('.nav-account[data-id]')?.dataset?.id || '');
  }

  function decoratePlatformTabs(root) {
    if (!root) return;
    setAttrIfChanged(root, 'role', 'toolbar');
    setAttrIfChanged(root, 'aria-label', '平台切换');
    setAttrIfChanged(root, 'aria-orientation', 'horizontal');

    const tabs = [...root.querySelectorAll(PLATFORM_SELECTOR)];
    const focusedIndex = tabs.indexOf(document.activeElement);
    const selectedIndex = tabs.findIndex(tab => tab.classList.contains('active'));
    const fallbackIndex = focusedIndex >= 0 ? focusedIndex : (selectedIndex >= 0 ? selectedIndex : (tabs.length ? 0 : -1));

    tabs.forEach((tab, index) => {
      setAttrIfChanged(tab, 'role', 'button');
      setAttrIfChanged(tab, 'aria-pressed', tab.classList.contains('active') ? 'true' : 'false');
      setAttrIfChanged(tab, 'tabindex', index === fallbackIndex ? '0' : '-1');
      const label = String(tab.title || tab.dataset.platform || '').trim();
      if (label) setAttrIfChanged(tab, 'aria-label', `切换平台：${label}`);
    });
  }

  function decorateAccountList(root) {
    if (!root) return;
    setAttrIfChanged(root, 'role', 'list');
    setAttrIfChanged(root, 'aria-label', '账号列表');
    const sideNav = root.closest('nav');
    if (sideNav) setAttrIfChanged(sideNav, 'aria-label', '账号导航');

    const mains = [...root.querySelectorAll(ACCOUNT_SELECTOR)];
    const focusedIndex = mains.indexOf(document.activeElement);
    const activeIndex = mains.findIndex(main => main.closest('.nav-account')?.classList.contains('active'));
    const fallbackIndex = focusedIndex >= 0 ? focusedIndex : (activeIndex >= 0 ? activeIndex : (mains.length ? 0 : -1));

    mains.forEach((main, index) => {
      const item = main.closest('.nav-account[data-id]');
      if (item) setAttrIfChanged(item, 'role', 'listitem');
      setAttrIfChanged(main, 'role', 'button');
      setAttrIfChanged(main, 'tabindex', index === fallbackIndex ? '0' : '-1');
      const name = String(main.querySelector('.nav-account-name')?.textContent || '').trim();
      setAttrIfChanged(main, 'aria-label', name ? `切换账号：${name}` : '切换账号');
      if (item?.classList.contains('active')) setAttrIfChanged(main, 'aria-current', 'page');
      else removeAttrIfPresent(main, 'aria-current');
    });
  }

  function focusPending(platformRoot, accountRoot) {
    if (!pendingFocus) return;
    const { kind, key } = pendingFocus;
    const root = kind === 'platform' ? platformRoot : accountRoot;
    const selector = kind === 'platform' ? PLATFORM_SELECTOR : ACCOUNT_SELECTOR;
    const keyOf = kind === 'platform' ? platformKey : accountKey;
    const target = [...(root?.querySelectorAll(selector) || [])].find(node => keyOf(node) === key);
    if (!target) return;
    pendingFocus = null;
    target.focus({ preventScroll: true });
  }

  function moveFocus(event, root, selector, keyOf, axis) {
    const target = event.target?.closest?.(selector);
    if (!target || !root.contains(target)) return false;
    const items = [...root.querySelectorAll(selector)];
    const index = items.indexOf(target);
    if (index < 0 || !items.length) return false;

    const previousKey = axis === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
    const nextKey = axis === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
    let nextIndex = -1;
    if (event.key === previousKey) nextIndex = (index - 1 + items.length) % items.length;
    else if (event.key === nextKey) nextIndex = (index + 1) % items.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;

    if (nextIndex >= 0) {
      event.preventDefault();
      items.forEach((item, itemIndex) => setAttrIfChanged(item, 'tabindex', itemIndex === nextIndex ? '0' : '-1'));
      items[nextIndex].focus({ preventScroll: true });
      return true;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const pending = { kind: axis === 'horizontal' ? 'platform' : 'account', key: keyOf(target) };
      pendingFocus = pending;
      target.click();
      queueMicrotask(() => {
        if (!pendingFocus || pendingFocus.kind !== pending.kind || pendingFocus.key !== pending.key) return;
        const replacement = [...root.querySelectorAll(selector)].find(node => keyOf(node) === pending.key);
        pendingFocus = null;
        replacement?.focus({ preventScroll: true });
      });
      return true;
    }
    return false;
  }

  function install() {
    const platformRoot = document.getElementById('account-tabs');
    const accountRoot = document.getElementById('nav-accounts');
    if (!platformRoot && !accountRoot) return;

    const sync = () => {
      decoratePlatformTabs(platformRoot);
      decorateAccountList(accountRoot);
      focusPending(platformRoot, accountRoot);
    };

    platformRoot?.addEventListener('keydown', event => {
      moveFocus(event, platformRoot, PLATFORM_SELECTOR, platformKey, 'horizontal');
    });
    accountRoot?.addEventListener('keydown', event => {
      moveFocus(event, accountRoot, ACCOUNT_SELECTOR, accountKey, 'vertical');
    });

    const observer = new MutationObserver(sync);
    if (platformRoot) observer.observe(platformRoot, { childList: true, subtree: true });
    if (accountRoot) observer.observe(accountRoot, { childList: true, subtree: true });
    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();

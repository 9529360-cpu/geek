import { serialQueue, errorMessage } from './model.mjs';
import { families, familyOf, visibleAccounts, viewportOf } from './models/shell.mjs';
import { createShellView } from './view.mjs';
import { batchCount } from './models/creation.mjs';
import { createBroadcastController } from './controllers/broadcast.mjs';
import { createSessionController } from './controllers/session.mjs';
import { createTranslationController } from './controllers/translation.mjs';
import { createAdvancedToolsController } from './controllers/advanced-tools.mjs';

export function mountShell({ document, window, api }) {
  const view = createShellView(document);
  const { $, on } = view;
  const enqueue = serialQueue();
  let current = null;
  let busy = false;
  const pendingWindows = new Set();
  let family = null;
  let selectedPlatform = null;
  let editingId = null;
  let panel = null;
  let returnFocus = null;
  const remembered = new Map();
  let layoutQueued = false;
  let layoutDirty = false;
  let layoutPromise = Promise.resolve();
  let broadcast = null;
  let session = null;
  let translation = null;
  let advanced = null;
  const setBusy = (value) => {
    busy = value;
    view.busy(value, Boolean(current && api), Boolean(api), pendingWindows);
    broadcast?.setShellBusy(value);
    session?.setShellBusy(value);
    translation?.setShellBusy(value);
    advanced?.setShellBusy(value);
  };
  const syncLayout = (visible = !panel) => api.layout(viewportOf($('webview-container'), visible, $('broadcast-job-bar')));

  function render(next) {
    current = next;
    const active = next.accounts.find((account) => account.id === next.activeId);
    if (active) {
      family = familyOf(active.platformId, next.platforms);
      remembered.set(family, active.id);
    }
    const groups = families(next);
    if (!groups.some((item) => item.key === family)) family = groups[0]?.key || null;
    view.accounts.render(next, family, { activate, context, moveAccount, family: selectFamily });
    if (panel === 'account-library-overlay') renderLibrary();
    broadcast?.renderShell(next);
    translation?.renderShell(next);
    advanced?.renderShell(next);
    setBusy(busy);
  }
  function acceptTranslationSnapshot(next, id) {
    const incoming = next.accounts.find((item) => item.id === id)?.translation;
    const previous = current?.accounts.find((item) => item.id === id)?.translation;
    if (!current || !incoming || incoming.revision < (previous?.revision || 0)) return;
    // Translation persistence can finish after account selection or another shell
    // mutation. Only its account-owned settings belong to this response.
    render({ ...current, accounts: current.accounts.map((item) => item.id === id ? { ...item, translation: incoming } : item) });
  }
  function run(operation, clearStatus = true, refreshOnError = true) {
    if (busy || broadcast?.busy || !api) return Promise.resolve(false);
    setBusy(true);
    if (clearStatus) view.status();
    return enqueue(async () => {
      try {
        await operation();
        return true;
      } catch (error) {
        if (refreshOnError) {
          try { render(await api.snapshot()); } catch { /* Keep the last authoritative snapshot. */ }
        }
        view.status(errorMessage(typeof error === 'string' ? error : 'UNKNOWN'));
        return false;
      } finally { setBusy(false); }
    });
  }
  async function windowAction(action) {
    // Shell controls never queue behind account I/O. Coalesce only the same action.
    if (!api || pendingWindows.has(action)) return false;
    pendingWindows.add(action);
    setBusy(busy);
    try {
      await api.windowAction(action);
      return true;
    } catch (error) {
      // Window chrome has no account-state recovery action. Never replace an
      // existing account diagnostic or create stale recovery UI while account
      // work is still pending. The control re-enables so the action itself can
      // be retried directly.
      if (!busy && !$('runtime-status-message').textContent) {
        view.status(errorMessage(typeof error === 'string' ? error : 'UNKNOWN'), false);
      }
      return false;
    } finally {
      pendingWindows.delete(action);
      setBusy(busy); // Never release another operation's account lock or clear its error.
    }
  }
  async function hidePanel() {
    if (panel) $(panel).classList.add('hidden');
    panel = null;
    broadcast?.panelChanged(null);
    session?.panelChanged(null);
    translation?.panelChanged(null);
    advanced?.panelChanged(null);
    view.statusPanel(null);
    await syncLayout(true);
    returnFocus?.focus();
  }
  async function showPanel(id, fill, focusId, isCurrent = () => true) {
    await syncLayout(false); // Do not expose an overlay until the native guest is hidden.
    if (!isCurrent()) { await syncLayout(!panel); return false; }
    if (!panel) returnFocus = document.activeElement;
    if (panel) $(panel).classList.add('hidden');
    panel = id;
    fill?.();
    view.statusPanel(id);
    $(id).classList.remove('hidden');
    broadcast?.panelChanged(id);
    session?.panelChanged(id);
    translation?.panelChanged(id);
    advanced?.panelChanged(id);
    if (id === 'ctx-menu') {
      const menu = $(id);
      const rect = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(parseFloat(menu.style.left), window.innerWidth - rect.width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(parseFloat(menu.style.top), window.innerHeight - rect.height - 8))}px`;
      menu.querySelector('button')?.focus();
    }
    if (focusId) window.setTimeout(() => $(focusId).focus(), 0);
  }
  function activate(id) {
    return run(async () => { await syncLayout(!panel); render(await api.activate(id)); await syncLayout(!panel); });
  }
  function selectFamily(key) {
    const list = visibleAccounts(current, key);
    const id = list.find((account) => account.id === remembered.get(key))?.id || list[0]?.id;
    if (id) activate(id);
  }
  function moveAccount(id, targetId) {
    if (panel) return Promise.resolve(false);
    return run(async () => { render(await api.moveAccount(id, targetId)); });
  }
  function edit(id) {
    return run(() => showPanel('account-settings-overlay', () => {
      editingId = id;
      view.editor(current.accounts.find((account) => account.id === id));
    }, 'account-settings-name'));
  }
  function editProxy(id) {
    return run(() => showPanel('proxy-overlay', () => {
      editingId = id;
      view.proxy(current.accounts.find((account) => account.id === id));
    }, 'proxy-host'));
  }
  function context(id, x, y) {
    return run(() => showPanel('ctx-menu', () => {
      const menu = $('ctx-menu');
      menu.replaceChildren();
      menu.setAttribute('role', 'menu');
      const item = (label, action) => {
        const button = view.accounts.button('ctx-item', label, action);
        button.textContent = label;
        button.setAttribute('role', 'menuitem');
        menu.append(button);
      };
      item('\u5237\u65b0\u5e94\u7528', () => run(async () => { render(await api.reload(id)); await hidePanel(); }));
      item('\u8d26\u53f7\u8bbe\u7f6e', () => edit(id));
      item('\u4ee3\u7406\u8bbe\u7f6e', () => editProxy(id));
      item('\u5173\u95ed\u9875\u9762\uff08\u4fdd\u7559\u767b\u5f55\uff09', () => run(async () => { render(await api.close(id)); await hidePanel(); }));
      item('\u5220\u9664\u5e94\u7528\uff08\u5c1a\u672a\u8fc1\u79fb\uff09', () => {});
      menu.lastElementChild.dataset.unavailable = 'true';
      menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - 210))}px`;
      menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - 230))}px`;
    }));
  }
  function renderLibrary() {
    view.accounts.library(current, edit, (id) => run(async () => { render(await api.setArchived(id, false)); }));
  }
  function selectPlatform(id) {
    selectedPlatform = id;
    view.accounts.platforms(current.platforms, id, selectPlatform);
    $('add-website-url-row').classList.toggle('hidden', id !== 'website');
    $('add-custom-url').required = id === 'website';
    setBusy(busy);
  }
  broadcast = createBroadcastController({ document, window, api, getShellSnapshot: () => current,
    showPanel, hidePanel, requestLayout });
  session = createSessionController({ document, api, showPanel, hidePanel, onChange: () => translation?.renderSession() });
  translation = createTranslationController({ document, api, getShellSnapshot: () => current, showPanel, hidePanel,
    acceptSnapshot: acceptTranslationSnapshot, getSession: () => ({ snapshot: session.snapshot, error: session.error }),
    refreshSession: () => session.refresh(), openSession: () => session.open(), reportError: (message) => view.status(message) });
  advanced = createAdvancedToolsController({ document, api, getShellSnapshot: () => current, showPanel, hidePanel,
    acceptSnapshot: acceptTranslationSnapshot, reportError: (message) => view.status(message) });
  on('btn-app-center', 'click', () => run(() => showPanel('add-overlay', () => {
    selectedPlatform = null;
    $('add-name').value = '';
    $('add-count').value = '1';
    $('add-custom-url').value = '';
    $('create-proxy-mode').value = 'system';
    $('create-proxy-host').value = '';
    $('create-proxy-port').value = '';
    $('create-proxy-fields').hidden = true;
    selectPlatform(null);
  }, 'add-name')));
  on('add-confirm', 'click', () => run(async () => {
    const platform = current.platforms.find((item) => item.id === selectedPlatform && item.enabled);
    if (!platform) throw 'PLATFORM_UNAVAILABLE';
    const count = batchCount($('add-count').value);
    const result = await api.createBatch({ name: $('add-name').value.trim(), count, platformId: platform.id,
      websiteUrl: platform.id === 'website' ? $('add-custom-url').value.trim() : null, proxy: view.readProxy(true) });
    render(result.snapshot); // The whole batch is durable, even if native activation fails.
    try {
      await hidePanel();
      render(await api.activate(result.createdIds[0])); // Only the first, not every new profile.
      await syncLayout(true);
    } catch {
      // Never replay the durable creation when showing its first account fails.
      throw 'ACCOUNTS_CREATED_OPEN_FAILED';
    }
  }));
  on('account-settings-save', 'click', () => {
    const id = editingId;
    run(async () => {
      const { name, fontSize, fontColor } = view.readDisplay();
      render(await api.updateDisplay(id, name, fontSize, fontColor));
      await hidePanel();
    });
  });
  on('proxy-save', 'click', () => {
    const id = editingId;
    run(async () => { render(await api.setProxy(id, view.readProxy())); await hidePanel(); });
  });
  on('archive', 'click', () => {
    const id = editingId;
    run(async () => { render(await api.setArchived(id, true)); await hidePanel(); });
  });
  on('btn-settings', 'click', () => run(async () => {
    await showPanel('settings-overlay', () => view.settings(current), 'close-to-tray');
    void session.refresh();
  }));
  on('settings-save', 'click', () => {
    const closeToTray = $('close-to-tray').checked;
    run(async () => { render(await api.settings({ closeToTray })); await hidePanel(); });
  });
  on('open-library', 'click', () => run(() => showPanel('account-library-overlay', renderLibrary, 'search')));
  on('search', 'input', renderLibrary);
  on('archived-only', 'change', renderLibrary);
  for (const id of ['add-close', 'add-cancel', 'account-settings-close', 'account-settings-cancel',
    'proxy-close', 'proxy-cancel', 'settings-close', 'settings-cancel', 'library-close']) {
    on(id, 'click', () => run(hidePanel));
  }
  on('create-proxy-mode', 'change', () => {
    $('create-proxy-fields').hidden = $('create-proxy-mode').value === 'system';
    setBusy(busy);
  });
  on('proxy-openProxy', 'change', () => setBusy(busy));
  on('btn-collapse', 'click', () => run(async () => {
    await syncLayout(false);
    $('side-nav').classList.toggle('collapsed');
    await syncLayout(!panel);
  }));
  for (const [id, action] of [['btn-win-min', 'minimize'], ['btn-win-max', 'toggleMaximize'], ['btn-win-close', 'close']]) {
    on(id, 'click', () => windowAction(action));
  }
  // Re-read authority and geometry only; never replay a failed mutation.
  on('runtime-retry', 'click', () => run(async () => {
    render(await api.snapshot());
    await syncLayout(!panel);
  }, true, false));
  document.querySelector('.top-bar').addEventListener('mousedown', (event) => {
    if (event.button === 0 && !event.target.closest('button, input, select, .tab-item')) {
      windowAction('drag');
    }
  });
  document.addEventListener('click', (event) => {
    if (event.target.closest('.win-controls')) return;
    if (panel === 'translation-popover' && !$(panel).contains(event.target) && !$('btn-translation').contains(event.target)) {
      run(hidePanel); return;
    }
    if (panel && (event.target === $(panel) || (panel === 'ctx-menu' && !$(panel).contains(event.target)))) run(hidePanel);
  });
  document.addEventListener('keydown', (event) => {
    if (panel && event.key === 'Escape') { event.preventDefault(); run(hidePanel); }
    if (panel && event.key === 'Tab') {
      const controls = [...$(panel).querySelectorAll('button, input, select, textarea, summary'),
        ...document.querySelector('.win-controls').querySelectorAll('button')]
        .filter((el) => !el.disabled && el.tabIndex !== -1 && el.getClientRects().length);
      if (!controls.length) return;
      // Window chrome precedes dialogs in the DOM; traverse the explicit boundary,
      // not browser tab order (which could otherwise enter background account tabs).
      const index = controls.indexOf(document.activeElement);
      const next = event.shiftKey ? (index <= 0 ? controls.length - 1 : index - 1) : (index + 1) % controls.length;
      event.preventDefault();
      controls[next].focus();
    }
  });
  function requestLayout() {
    if (!current || !api) return Promise.resolve();
    layoutDirty = true;
    if (layoutQueued) return layoutPromise;
    layoutQueued = true;
    layoutPromise = enqueue(async () => {
      try { while (layoutDirty) { layoutDirty = false; await syncLayout(!panel); } }
      catch (error) { view.status(errorMessage('WEBVIEW_FAILED')); throw error; }
      finally { layoutQueued = false; }
    });
    return layoutPromise;
  }
  const resize = () => { void requestLayout().catch(() => {}); };
  window.addEventListener('resize', resize);
  const observer = window.ResizeObserver ? new window.ResizeObserver(resize) : null;
  observer?.observe($('webview-container'));
  if (api) run(async () => { render(await api.snapshot()); await syncLayout(true); }, true, false);
  else {
    setBusy(false);
    view.status('\u8bf7\u4ece Tauri Windows \u5f00\u53d1\u7248\u542f\u52a8\uff1b\u6d4f\u89c8\u5668\u9884\u89c8\u4e0d\u6a21\u62df\u8d26\u53f7\u529f\u80fd\u3002');
  }
  return { idle: async () => {
    await enqueue(() => {}); await broadcast.idle(); await session.idle(); await translation.idle(); await advanced.idle(); await enqueue(() => {});
  }, dispose: () => {
    observer?.disconnect(); broadcast.dispose(); session.dispose(); translation.dispose(); advanced.dispose(); window.removeEventListener?.('resize', resize);
  } };
}

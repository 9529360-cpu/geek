import { serialQueue, errorMessage } from './model.mjs';
import { createShellView } from './view.mjs';

// Only transient selection/draft/busy state lives here. Rust owns account state.
export function mountShell({ document, window, api }) {
  const view = createShellView(document);
  const { $ } = view;
  const enqueue = serialQueue();
  let current = null;
  let busy = false;
  let editingId = null;
  let renderedEditorId = null;
  let layoutPending = false;
  let layoutDirty = false;

  function syncWebsiteForm() { view.syncWebsiteForm(current, busy); }
  function setBusy(value) {
    busy = value;
    view.setBusy(current, busy, Boolean(api));
  }
  function renderEditor() {
    const account = current?.accounts.find((a) => a.id === editingId);
    view.renderEditor(account, renderedEditorId !== editingId);
    if (!account) editingId = null;
    renderedEditorId = editingId;
  }

  function editAccount(id) {
    if (busy) return;
    editingId = id;
    renderedEditorId = null;
    renderEditor();
    $('editor').scrollIntoView({ block: 'nearest' });
    $('edit-name').focus();
  }

  function renderAccounts() {
    view.renderAccounts(current, (id) => run(() => api.activate(id)), editAccount);
    setBusy(busy);
  }

  function render(next) {
    const first = !current;
    current = next;
    view.renderSnapshot(next, first);
    renderAccounts();
    renderEditor();
    setBusy(busy);
  }

  function run(operation) {
    if (busy || !api) return;
    setBusy(true);
    $('status').textContent = '正在处理…';
    enqueue(async () => {
      try {
        const next = await operation();
        if (next) render(next);
        $('status').textContent = '就绪 · 已打开不等于已登录；归档不会删除登录数据';
      } catch (error) {
        try { render(await api.snapshot()); } catch { /* retain last known state */ }
        $('status').textContent = errorMessage(typeof error === 'string' ? error : 'UNKNOWN');
      } finally {
        setBusy(false);
      }
    });
  }

  $('platform').addEventListener('change', syncWebsiteForm);
  view.createProxy.mode.addEventListener('change', () => view.createProxy.sync(busy || !current));
  view.editProxy.mode.addEventListener('change', () => view.editProxy.sync(busy || !current));
  $('search').addEventListener('input', renderAccounts);
  $('archived-only').addEventListener('change', renderAccounts);
  $('retry').addEventListener('click', () => run(() => api.snapshot()));
  $('create-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = $('name').value.trim();
    const platformId = $('platform').value;
    const websiteUrl = platformId === 'website' ? $('website-url').value.trim() : null;
    if (!name) { $('name').focus(); return; }
    run(async () => {
      const proxy = view.createProxy.read();
      const next = await api.create({ name, platformId, websiteUrl, proxy });
      $('search').value = '';
      $('archived-only').checked = false;
      $('name').value = '';
      $('website-url').value = '';
      $('add-panel').open = false;
      view.createProxy.render();
      render(next);
      return api.activate(next.accounts.at(-1).id);
    });
  });
  $('edit-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const id = editingId;
    const name = $('edit-name').value.trim();
    if (id && name) run(async () => {
      const next = await api.rename(id, name);
      const account = next.accounts.find((item) => item.id === id);
      if (account) $('edit-name').value = account.name;
      // A successful rename must not discard an unsaved proxy draft.
      return next;
    });
  });
  $('proxy-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const id = editingId;
    if (!id) return;
    run(async () => {
      const proxy = view.editProxy.read();
      const next = await api.setProxy(id, proxy);
      // Reset this form only after the authoritative native save succeeded.
      view.editProxy.render(next.accounts.find((account) => account.id === id)?.proxy);
      return next;
    });
  });
  $('edit-cancel').addEventListener('click', () => { editingId = null; renderEditor(); });
  $('archive').addEventListener('click', () => {
    const account = current?.accounts.find((a) => a.id === editingId);
    if (!account) return;
    const id = account.id;
    run(async () => {
      const next = account.archived
        ? await api.setArchived(id, false)
        : await api.setArchived(id, true);
      editingId = null;
      return next;
    });
  });
  $('close-to-tray').addEventListener('change', () => {
    const closeToTray = $('close-to-tray').checked;
    run(() => api.settings({ closeToTray }));
  });
  $('reload').addEventListener('click', () => {
    const id = current?.activeId;
    if (id) run(() => api.reload(id));
  });
  $('close').addEventListener('click', () => {
    const id = current?.activeId;
    if (id) run(() => api.close(id));
  });

  function requestLayout() {
    if (!api || !current) return;
    layoutDirty = true;
    if (layoutPending) return;
    layoutPending = true;
    enqueue(async () => {
      try {
        while (layoutDirty) {
          layoutDirty = false;
          await api.layout();
        }
      } catch {
        $('status').textContent = '页面布局更新失败，请重新选择账号。';
      } finally { layoutPending = false; }
    });
  }
  window.addEventListener('resize', requestLayout);
  if (api) {
    run(() => api.snapshot());
  } else {
    setBusy(false);
    $('status').textContent = '请通过 Windows Tauri 客户端启动；浏览器预览不会模拟账号操作。';
  }
}

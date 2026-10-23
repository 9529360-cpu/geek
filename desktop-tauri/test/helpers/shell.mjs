import { connectDesktop } from '../../frontend/api/desktop.mjs';
import { mountShell } from '../../frontend/controller.mjs';
import { dom, settled } from './dom.mjs';

export async function fixture({ initialFailures = [], initialState = {}, beforeInvoke = () => {} } = {}) {
  const ui = dom();
  const calls = [];
  const failures = new Set(initialFailures);
  const state = {
    accounts: ['a', 'b'].map((id) => ({ id, name: id, platformId: 'whatsapp', archived: false, proxy: { mode: 'system' } })),
    platforms: [{ id: 'whatsapp', family: 'whatsapp', name: 'WhatsApp', enabled: true },
      { id: 'telegram-z', family: 'telegram', name: 'TelegramZ', enabled: true },
      { id: 'telegram-k', family: 'telegram', name: 'TelegramK', enabled: true },
      { id: 'line', family: 'line', name: 'LINE', enabled: false },
      { id: 'website', family: 'website', name: 'Website', enabled: true }],
    activeId: 'a', openedIds: ['a', 'b'], settings: { closeToTray: false }, trayAvailable: true,
  };
  Object.assign(state, structuredClone(initialState));
  const api = connectDesktop(async (name, args) => {
    calls.push([name, structuredClone(args)]);
    await beforeInvoke(name, args);
    const account = state.accounts.find((a) => a.id === args?.id);
    if (name === 'account_set_proxy' || name === 'account_set_archived' || name === 'account_close') {
      state.openedIds = state.openedIds.filter((id) => id !== args.id);
      if (state.activeId === args.id) state.activeId = null;
    }
    if (failures.has(name) || (name === 'desktop_layout' && !args.viewport.visible && failures.has('hide'))) {
      throw name === 'desktop_layout' || name === 'account_activate' ? 'WEBVIEW_FAILED' : 'STORE_IO';
    }
    if (name === 'account_rename') account.name = args.name;
    if (name === 'account_set_proxy') account.proxy = args.proxy;
    if (name === 'account_set_archived') account.archived = args.archived;
    if (name === 'account_activate') { state.activeId = args.id; if (!state.openedIds.includes(args.id)) state.openedIds.push(args.id); }
    if (name === 'desktop_settings') state.settings = args.settings;
    if (name === 'account_create') state.accounts.push({ id: `new-${state.accounts.length}`, archived: false, ...args });
    if (name === 'account_create_batch') {
      const createdIds = [];
      const existing = state.accounts.filter((a) => a.platformId === args.platformId).length;
      const platform = state.platforms.find((p) => p.id === args.platformId);
      for (let i = 0; i < args.count; i++) {
        const id = `new-${state.accounts.length}`;
        const label = args.name ? (args.count > 1 ? `${args.name} ${i + 1}` : args.name) : `${platform.name} ${existing + i + 1}`;
        createdIds.push(id);
        state.accounts.push({ id, name: label, platformId: args.platformId, websiteUrl: args.websiteUrl, proxy: args.proxy, archived: false });
      }
      return { snapshot: structuredClone(state), createdIds };
    }
    return name.startsWith('desktop_') && !['desktop_settings', 'desktop_snapshot'].includes(name) ? null : structuredClone(state);
  });
  const shell = mountShell({ ...ui, api });
  await shell.idle();
  if (!initialFailures.length) await settled(ui.get);
  const click = async (id) => { ui.get(id).fire('click'); await shell.idle(); };
  const context = async (id, index) => {
    ui.get('nav-accounts').children.find((e) => e.dataset.id === id).fire('contextmenu', { clientX: 100, clientY: 100 });
    await shell.idle();
    ui.get('ctx-menu').children[index].fire('click');
    await shell.idle();
  };
  return { ...ui, shell, calls, state, failures, click, context };
}

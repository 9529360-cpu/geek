import { createSessionView } from '../views/session.mjs';
import { sessionOf, translationError } from '../models/translation.mjs';

export function createSessionController({ document, api, showPanel, hidePanel, onChange = () => {} }) {
  let snapshot = null;
  let epoch = 0;
  let disposed = false;
  let shellBusy = false;
  let pending = '';
  let error = '';
  let refreshTask = null;
  const tasks = new Set();
  const connected = Boolean(api?.sessionSnapshot && api?.sessionLogin && api?.sessionLogout && api?.sessionRefresh);
  const track = (task) => {
    tasks.add(task);
    void task.finally(() => tasks.delete(task)).catch(() => {});
    return task;
  };
  const view = createSessionView(document, { open: () => track(open()), close: () => track(close()),
    login: () => track(login()), logout: () => track(logout()), refresh: () => refresh() });
  const render = () => { if (!disposed) view.render(snapshot, { pending, error, shellBusy, connected }); };
  function publish(next, operationEpoch) {
    if (disposed || operationEpoch !== epoch) return false;
    const value = sessionOf(next);
    if (snapshot && value.revision < snapshot.revision) return false;
    snapshot = value;
    error = snapshot.issue ? translationError(snapshot.issue) : '';
    onChange(snapshot, error);
    return true;
  }
  async function read() {
    const operationEpoch = ++epoch;
    try { publish(await api.sessionSnapshot(), operationEpoch); }
    catch (failure) { if (operationEpoch === epoch) error = translationError(failure); }
    render();
  }
  async function open() {
    if (!connected || shellBusy) return;
    try {
      await showPanel('session-overlay', render, snapshot?.state === 'signedIn' ? 'session-btn-enter' : 'session-in-email');
      if (snapshot?.state === 'signedIn') void refresh();
    } catch (failure) { error = translationError(failure); render(); }
  }
  async function close() {
    view.clearPassword();
    try { await hidePanel(); } catch (failure) { error = translationError(failure); render(); }
  }
  function refresh() {
    if (!connected || disposed || ['login', 'logout'].includes(pending)) return Promise.resolve(false);
    if (refreshTask) return refreshTask;
    const operationEpoch = ++epoch;
    pending = 'refresh'; error = ''; render();
    refreshTask = track((async () => {
      try { return publish(await api.sessionRefresh(), operationEpoch); }
      catch (failure) {
        if (operationEpoch === epoch && !disposed) { error = translationError(failure); onChange(snapshot, error); }
        return false;
      } finally {
        if (operationEpoch === epoch) { pending = ''; render(); }
        refreshTask = null;
      }
    })());
    return refreshTask;
  }
  async function login() {
    if (!connected || disposed || shellBusy || ['login', 'logout'].includes(pending)) return false;
    const credentials = view.credentials();
    view.clearPassword();
    if (!credentials.email || !credentials.password) { error = '请输入邮箱和密码。'; render(); return false; }
    const operationEpoch = ++epoch;
    pending = 'login'; error = ''; render();
    try {
      const request = api.sessionLogin(credentials.email, credentials.password);
      credentials.password = '';
      return publish(await request, operationEpoch);
    } catch (failure) {
      if (operationEpoch === epoch && !disposed) error = translationError(failure);
      return false;
    } finally {
      credentials.password = ''; view.clearPassword();
      if (operationEpoch === epoch) { pending = ''; render(); }
    }
  }
  async function logout() {
    if (!connected || disposed || shellBusy || ['login', 'logout'].includes(pending)) return false;
    const operationEpoch = ++epoch;
    pending = 'logout'; error = ''; view.clearPassword(); render();
    try { return publish(await api.sessionLogout(), operationEpoch); }
    catch (failure) {
      if (operationEpoch === epoch && !disposed) error = `${translationError(failure)} 退出未完成，本机登录状态仍然保留。`;
      return false;
    } finally { if (operationEpoch === epoch) { pending = ''; render(); } }
  }
  render();
  if (connected) track(read());
  return {
    open: () => track(open()), refresh,
    get snapshot() { return snapshot; }, get error() { return error; },
    setShellBusy(value) { shellBusy = value; render(); },
    panelChanged(id) { if (id !== 'session-overlay') view.clearPassword(); },
    idle: async () => { while (tasks.size) await Promise.allSettled([...tasks]); },
    dispose() { disposed = true; epoch += 1; view.clearPassword(); view.dispose(); },
  };
}

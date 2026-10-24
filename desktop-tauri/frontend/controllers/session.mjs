import { createSessionView } from '../views/session.mjs';
import { sessionOf, translationError } from '../models/translation.mjs';

export function createSessionController({ document, api, showPanel, hidePanel, onChange = () => {}, timers = globalThis }) {
  let snapshot = null;
  let epoch = 0;
  let disposed = false;
  let shellBusy = false;
  let pending = '';
  let error = '';
  let readError = '';
  let refreshTask = null;
  let snapshotTask = null;
  let readRequested = false;
  let panel = null;
  let visibilityEpoch = 0;
  let timer = null;
  const tasks = new Set();
  const connected = Boolean(api?.sessionSnapshot && api?.sessionLogin && api?.sessionLogout && api?.sessionRefresh);
  const track = (task) => {
    tasks.add(task);
    void task.finally(() => tasks.delete(task)).catch(() => {});
    return task;
  };
  const view = createSessionView(document, { open: () => track(open()), close: () => track(close()),
    login: () => track(login()), logout: () => track(logout()), refresh: () => refresh() });
  const currentError = () => error || readError || (snapshot?.issue ? translationError(snapshot.issue) : '');
  const notify = () => onChange(snapshot, currentError());
  const render = () => { if (!disposed) view.render(snapshot, { pending, error: currentError(), shellBusy, connected }); };
  const visible = () => !disposed && ['session-overlay', 'translation-popover'].includes(panel)
    && document.hidden !== true && document.visibilityState !== 'hidden';
  function stopTimer() {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  }
  function scheduleRead() {
    stopTimer();
    if (!connected || !visible() || pending || snapshotTask) return;
    timer = timers.setTimeout(() => { timer = null; void read(); }, 1500);
  }
  function publish(next, operationEpoch, quiet = false) {
    if (disposed || operationEpoch !== epoch) return false;
    const value = sessionOf(next);
    if (snapshot && value.revision < snapshot.revision) return false;
    snapshot = value;
    readError = '';
    // A background snapshot may update authority, but cannot erase feedback from
    // a failed explicit operation such as durable logout or balance refresh.
    if (!quiet) error = '';
    notify();
    return true;
  }
  function read(initial = false) {
    stopTimer();
    if (!connected || disposed || pending || (!initial && !visible())) return Promise.resolve(false);
    if (snapshotTask) { readRequested = true; return snapshotTask; }
    readRequested = false;
    const operationEpoch = epoch;
    const presentation = visibilityEpoch;
    snapshotTask = track((async () => {
      try {
        // Assign the single-flight slot before even a synchronous IPC failure.
        await Promise.resolve();
        if (disposed || operationEpoch !== epoch || presentation !== visibilityEpoch) return false;
        const next = await api.sessionSnapshot();
        if (presentation !== visibilityEpoch) return false;
        return publish(next, operationEpoch, true);
      } catch (failure) {
        if (!disposed && operationEpoch === epoch && presentation === visibilityEpoch) {
          readError = translationError(failure); notify();
        }
        return false;
      } finally {
        snapshotTask = null;
        const again = readRequested; readRequested = false;
        if (!disposed) {
          render();
          if (again && visible() && !pending) void read();
          else scheduleRead();
        }
      }
    })());
    return snapshotTask;
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
    stopTimer(); pending = 'refresh'; error = ''; readError = ''; render();
    refreshTask = track((async () => {
      try { return publish(await api.sessionRefresh(), operationEpoch); }
      catch (failure) {
        if (operationEpoch === epoch && !disposed) { error = translationError(failure); notify(); }
        return false;
      } finally {
        if (operationEpoch === epoch) { pending = ''; render(); scheduleRead(); }
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
    stopTimer(); pending = 'login'; error = ''; readError = ''; render();
    try {
      const request = api.sessionLogin(credentials.email, credentials.password);
      credentials.password = '';
      return publish(await request, operationEpoch);
    } catch (failure) {
      if (operationEpoch === epoch && !disposed) error = translationError(failure);
      return false;
    } finally {
      credentials.password = ''; view.clearPassword();
      if (operationEpoch === epoch) { pending = ''; render(); scheduleRead(); }
    }
  }
  async function logout() {
    if (!connected || disposed || shellBusy || ['login', 'logout'].includes(pending)) return false;
    const operationEpoch = ++epoch;
    stopTimer(); pending = 'logout'; error = ''; readError = ''; view.clearPassword(); render();
    try { return publish(await api.sessionLogout(), operationEpoch); }
    catch (failure) {
      if (operationEpoch === epoch && !disposed) error = `${translationError(failure)} 退出未完成，本机登录状态仍然保留。`;
      return false;
    } finally { if (operationEpoch === epoch) { pending = ''; render(); scheduleRead(); } }
  }
  function visibilityChanged() {
    visibilityEpoch += 1; stopTimer();
    if (visible()) void read();
    else readRequested = false;
  }
  document.addEventListener('visibilitychange', visibilityChanged);
  render();
  if (connected) void read(true);
  return {
    open: () => track(open()), refresh,
    get snapshot() { return snapshot; }, get error() { return currentError(); },
    setShellBusy(value) { shellBusy = value; render(); },
    panelChanged(id) {
      if (id !== 'session-overlay') view.clearPassword();
      if (panel === id) return;
      panel = id; visibilityChanged();
    },
    idle: async () => { while (tasks.size) await Promise.allSettled([...tasks]); },
    dispose() {
      disposed = true; epoch += 1; visibilityEpoch += 1; stopTimer();
      document.removeEventListener('visibilitychange', visibilityChanged);
      view.clearPassword(); view.dispose();
    },
  };
}

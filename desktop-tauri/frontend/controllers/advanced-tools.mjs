import { createAdvancedToolsView } from '../views/advanced-tools.mjs';
import { advancedError, backupDataOf, backupPreviewOf, exportResult, historyOf, restoreResult } from '../models/advanced-tools.mjs';

const overlay = 'advanced-tools-overlay';
const conflicts = new Set(['BROADCAST_PRESET_CONFLICT', 'TRANSLATION_SETTINGS_CONFLICT']);

export function createAdvancedToolsController({ document, api, getShellSnapshot, showPanel, hidePanel,
  acceptSnapshot, reportError = () => {} }) {
  const available = {
    contacts: typeof api?.broadcastExportContacts === 'function',
    report: ['broadcastHistory', 'broadcastExportHistory'].every((name) => typeof api?.[name] === 'function'),
    exportBackup: typeof api?.accountExportBackup === 'function',
    pickBackup: typeof api?.accountPickBackup === 'function',
    restoreBackup: typeof api?.accountRestoreBackup === 'function',
  };
  available.backup = available.exportBackup || available.pickBackup;
  const operations = new Set();
  let mode = null;
  let ownerId = null;
  let epoch = 0;
  let open = false;
  let opening = false;
  let invalidated = false;
  let disposed = false;
  let shellBusy = false;
  let activeId = getShellSnapshot()?.activeId;
  let pending = null;
  let history = null;
  let preview = null;
  let remaining = {};
  let sections = {};
  let needsReview = false;
  const track = (operation) => {
    operations.add(operation);
    void operation.finally(() => operations.delete(operation)).catch(() => {});
    return operation;
  };
  const view = createAdvancedToolsView(document, {
    open: (next) => track(openTool(next)), close: () => track(close()),
    exportContacts: () => track(exportContacts()), loadReport: () => track(loadReport()),
    exportReport: () => track(exportReport()), exportBackup: () => track(exportBackup()),
    pickBackup: () => track(pickBackup()), restoreBackup: () => track(restoreBackup()),
  });
  const account = () => getShellSnapshot()?.accounts.find((item) => item.id === getShellSnapshot().activeId && !item.archived);
  const current = (ticket) => !disposed && open && !invalidated && ticket.epoch === epoch
    && ticket.accountId === ownerId && account()?.id === ownerId;
  const statusKey = () => mode === 'backup' ? 'backup-import' : mode;

  function render() {
    if (disposed) return;
    view.menu({ account: account(), disabled: shellBusy || opening, available });
    view.availability({ busy: shellBusy || Boolean(pending), invalidated, history, available,
      canRestore: available.restoreBackup && !needsReview && Object.keys(remaining).length > 0 });
  }
  function reset() {
    epoch += 1; open = false; opening = false; pending = null; invalidated = false;
    ownerId = null; mode = null; history = null; preview = null; remaining = {}; sections = {}; needsReview = false;
  }
  async function close() {
    if (!open && !opening) return;
    reset(); render();
    try { await hidePanel(); } catch (error) { if (!disposed) reportError(advancedError(error)); }
  }
  async function openTool(nextMode) {
    const item = account();
    if (disposed || shellBusy || opening || !item || !available[nextMode]) return;
    reset();
    const token = epoch;
    mode = nextMode; ownerId = item.id; opening = true; render();
    try {
      await showPanel(overlay, () => {
        view.open(nextMode, item); open = true; render();
      }, 'at-close', () => !disposed && token === epoch && account()?.id === item.id);
      if (!current({ accountId: item.id, epoch: token })) return;
      if (nextMode === 'report') await loadReport();
    } catch (error) {
      if (!disposed && token === epoch) reportError(advancedError(error));
    } finally {
      if (!disposed && token === epoch) { opening = false; render(); }
    }
  }
  async function operate(action, key, loading, operation) {
    if (!open || invalidated || disposed || shellBusy || pending || account()?.id !== ownerId) return;
    const ticket = { action, accountId: ownerId, epoch };
    pending = ticket; view.status(key, loading); render();
    try { await operation(ticket); }
    catch (error) {
      if (current(ticket)) {
        if (action === 'restore' && conflicts.has(typeof error === 'string' ? error : error?.code)) needsReview = true;
        view.status(key, advancedError(error), 'error');
        if (action === 'history' && !history) view.reportUnavailable();
      }
    } finally {
      if (pending === ticket) { pending = null; render(); }
    }
  }
  async function exportContacts() {
    if (!available.contacts || mode !== 'contacts') return;
    await operate('contacts', 'contacts', '正在读取当前账号联系人…', async (ticket) => {
      const result = exportResult(await api.broadcastExportContacts(ticket.accountId), ticket.accountId, null);
      if (current(ticket)) view.status('contacts', result.saved ? `已导出 ${result.rowCount} 个联系人。` : '已取消导出。',
        result.saved ? 'success' : '');
    });
  }
  async function loadReport() {
    if (!available.report || mode !== 'report') return;
    await operate('history', 'report', '正在读取任务记录…', async (ticket) => {
      const result = historyOf(await api.broadcastHistory(ticket.accountId), ticket.accountId);
      if (!current(ticket)) return;
      history = result; view.renderHistory(result); view.status('report');
    });
  }
  async function exportReport() {
    if (!available.report || mode !== 'report' || !history?.rows.length) return;
    const revision = history.revision;
    await operate('report-export', 'report', '正在导出任务记录…', async (ticket) => {
      const result = exportResult(await api.broadcastExportHistory(ticket.accountId, revision), ticket.accountId, revision);
      if (current(ticket)) view.status('report', result.saved ? `已导出 ${result.rowCount} 条任务记录。` : '已取消导出。',
        result.saved ? 'success' : '');
    });
  }
  async function exportBackup() {
    if (!available.exportBackup || mode !== 'backup') return;
    await operate('backup-export', 'backup-export', '正在导出设置备份…', async (ticket) => {
      const result = exportResult(await api.accountExportBackup(ticket.accountId), ticket.accountId);
      if (current(ticket)) view.status('backup-export', result.saved ? '设置备份已导出。' : '已取消导出。', result.saved ? 'success' : '');
    });
  }
  async function pickBackup() {
    if (!available.pickBackup || mode !== 'backup') return;
    await operate('backup-pick', 'backup-import', '请选择设置备份文件…', async (ticket) => {
      const value = await api.accountPickBackup(ticket.accountId);
      if (!current(ticket)) return;
      if (value === null) {
        view.status('backup-import', preview ? '已取消本次选择，保留上次已核对的备份。' : '已取消选择。');
        return;
      }
      const result = backupPreviewOf(value, ticket.accountId);
      preview = result; remaining = backupDataOf(result.backup.data); sections = {}; needsReview = false;
      view.renderBackup(preview, sections);
      view.status('backup-import', Object.keys(remaining).length ? '已读取备份，请核对范围后恢复。' : '文件未包含可恢复的设置。');
    });
  }
  async function restoreBackup() {
    if (!available.restoreBackup || mode !== 'backup' || !preview || needsReview || !Object.keys(remaining).length) return;
    const requested = backupDataOf(remaining);
    const presetRevision = preview.presetRevision;
    const translationRevision = preview.translationRevision;
    await operate('restore', 'backup-import', '正在恢复设置…', async (ticket) => {
      const result = restoreResult(await api.accountRestoreBackup(ticket.accountId, presetRevision, translationRevision, requested),
        ticket.accountId, requested);
      if (current(ticket)) {
        for (const kind of Object.keys(requested)) sections[kind] = result[kind];
        remaining = result.remaining;
        const incomplete = Object.keys(remaining).length > 0;
        if (incomplete) {
          preview = { ...preview, presetRevision: result.presets.revision, translationRevision: result.translation.revision };
        } else preview = null;
        view.renderBackup(preview, sections);
        view.status('backup-import', incomplete ? '部分设置未完成，重试只会恢复未完成部分。' : '设置恢复完成。', incomplete ? 'error' : 'success');
      }
      // Remember completed sections before publishing their durable authority.
      // A shell refresh failure must never put a completed owner back in retry.
      if (!disposed && requested.translation && ['restored', 'unchanged'].includes(result.translation.status)) {
        try { acceptSnapshot(result.snapshot, ticket.accountId); }
        catch { reportError('设置已恢复，但界面状态未能同步，请重新读取。'); }
      }
    });
  }

  return {
    renderShell(next) {
      if (disposed) return;
      if ((open || opening) && (next.activeId !== activeId || !next.accounts.some((item) => item.id === ownerId && !item.archived))) {
        epoch += 1; invalidated = true; opening = false; pending = null;
        view.status(statusKey(), '账号已切换，请重新打开工具。', 'error');
      }
      activeId = next.activeId; render();
    },
    setShellBusy(value) { shellBusy = Boolean(value); render(); },
    panelChanged(id) {
      if (id === overlay) { open = true; return; }
      if (open || opening) { reset(); render(); }
    },
    async idle() { while (operations.size) await Promise.allSettled([...operations]); },
    dispose() { if (disposed) return; reset(); disposed = true; view.dispose(); },
  };
}

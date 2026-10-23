import { emptyDraft, normalizeCatalog, normalizeAttachments, normalizeImportedContacts, normalizeResolvedRecipients, draftPayload,
  submissionFor, hasExportableIssues, audienceSourceKinds, recipientSourceIssue, executing, terminal } from '../models/broadcast.mjs';
import { errorCode, errorMessage, audienceSourceError } from '../models/broadcast-status.mjs';
import { wire, unavailable } from '../views/broadcast-elements.mjs';
import { createBroadcastEditor } from '../views/broadcast-editor.mjs';
import { createBroadcastJobs } from '../views/broadcast-jobs.mjs';

export function createBroadcastController({ document, window, api, getShellSnapshot, showPanel, hidePanel, requestLayout }) {
  const $ = (id) => document.getElementById(id);
  const apiAvailable = ['broadcastCatalog', 'broadcastCreate', 'broadcastSnapshot', 'broadcastControl']
    .every((name) => typeof api?.[name] === 'function');
  const attachmentsAvailable = ['broadcastPickAttachments', 'broadcastReleaseAttachments']
    .every((name) => typeof api?.[name] === 'function');
  const importAvailable = typeof api?.broadcastImportContacts === 'function';
  const resolveAvailable = typeof api?.broadcastResolveRecipients === 'function';
  const audienceAvailable = typeof api?.broadcastResolveAudience === 'function';
  const exportAvailable = typeof api?.broadcastExportFailures === 'function';
  const operations = new Set();
  const drafts = new Map();
  const pendingControls = new Set();
  const pendingExports = new Set();
  const listeners = [];
  let shell = getShellSnapshot();
  let renderedActiveId = shell?.activeId;
  let shellBusy = false;
  let panel = null;
  let editorOwner = null;
  let catalog = null;
  let submission = null;
  let loading = false;
  let creating = false;
  let picking = false;
  let removingAttachment = false;
  let importing = false;
  let editorEpoch = 0;
  let loadEpoch = 0;
  let disposed = false;
  let snapshot = { revision: -1, jobs: [] };
  let snapshotRequest = null;
  let pollTimer = null;
  let lastStatus = { text: '', state: 'ready', retry: false };
  let editor;
  let jobsView;
  const bind = (node, type, fn) => {
    node.addEventListener(type, fn); listeners.push(() => node.removeEventListener(type, fn));
  };
  function track(promise) {
    const pendingOperation = Promise.resolve(promise);
    operations.add(pendingOperation);
    pendingOperation.finally(() => operations.delete(pendingOperation)).catch(() => {});
    return pendingOperation;
  }
  const report = (error) => {
    if (disposed) return;
    const code = errorCode(error);
    lastStatus = { text: errorMessage(error), state: 'error', retry: !/ATTACHMENT|FILE|IMPORT|EXPORT/.test(code) && /CATALOG|READY|UNAVAILABLE/.test(code) };
    editor?.status(lastStatus.text, lastStatus.state, lastStatus.retry);
  };
  const owner = () => shell?.accounts.find((account) => account.id === editorOwner);
  const mismatch = () => Boolean(editorOwner && shell?.activeId !== editorOwner);
  const activeJob = (accountId) => snapshot.jobs.find((job) => job.accountId === accountId && executing.has(job.state));

  function stash() {
    if (editorOwner && editor) drafts.set(editorOwner, { draft: editor.read(), submission });
  }

  function refreshEditor() {
    if (!editor || !editorOwner || disposed) return;
    const running = activeJob(editorOwner);
    editor.render(snapshot.jobs, running?.id === submission?.id ? null : running);
    if (mismatch()) editor.status(errorMessage('BROADCAST_ACCOUNT_CHANGED'), 'error');
    else editor.status(lastStatus.text, lastStatus.state, lastStatus.retry);
    editor.availability({ shellBusy, creating, loading, mismatch: mismatch(), apiAvailable, pendingControls,
      attachmentsAvailable, attachmentBusy: picking || removingAttachment, importAvailable, resolveAvailable, audienceAvailable, importBusy: importing });
  }

  function render() {
    if (disposed) return;
    const account = shell?.accounts.find((item) => item.id === shell.activeId && !item.archived);
    const supported = account && ['whatsapp', 'whatsapp-pure'].includes(account.platformId);
    wire($('btn-broadcast'), shellBusy || creating || !apiAvailable || !supported);
    $('btn-broadcast').title = supported ? '群发' : account ? '当前平台群发尚未迁移；现支持 WhatsApp' : '请先选择 WhatsApp 账号';
    $('btn-broadcast').setAttribute('aria-label', $('btn-broadcast').title);
    wire($('bc-menu-send'), shellBusy || creating || !apiAvailable || !supported);
    jobsView?.render(snapshot.jobs, shell?.activeId, shellBusy, pendingControls, apiAvailable,
      { available: exportAvailable, pending: pendingExports });
    refreshEditor();
  }

  function applySnapshot(next) {
    if (disposed) return;
    if (!next || !Number.isSafeInteger(next.revision) || !Array.isArray(next.jobs)
      || next.jobs.some((job) => !job || typeof job.id !== 'string' || typeof job.accountId !== 'string')) {
      throw 'BROADCAST_UNKNOWN';
    }
    if (next.revision < snapshot.revision) return;
    snapshot = { ...next, jobs: next.jobs.slice() };
    render();
  }

  function schedulePoll() {
    if (pollTimer !== null) window.clearTimeout(pollTimer);
    pollTimer = null;
    if (disposed || !apiAvailable) return;
    if (panel !== 'broadcast-task-center-overlay' && panel !== 'broadcast-overlay'
      && !snapshot.jobs.some((job) => !terminal.has(job.state))) return;
    pollTimer = window.setTimeout(() => { pollTimer = null; void refreshSnapshot(); }, 1000);
  }

  function refreshSnapshot() {
    if (disposed || !apiAvailable) return Promise.resolve();
    if (snapshotRequest) return snapshotRequest;
    snapshotRequest = track((async () => {
      try { applySnapshot(await api.broadcastSnapshot()); }
      catch (error) { if (!disposed) jobsView.feedback(errorMessage(error)); }
      finally { snapshotRequest = null; schedulePoll(); }
    })());
    return snapshotRequest;
  }

  async function loadCatalog() {
    if (disposed || !apiAvailable || !editorOwner || panel !== 'broadcast-overlay' || creating || mismatch()) return;
    const accountId = editorOwner;
    const epoch = ++loadEpoch;
    loading = true;
    catalog = null;
    editor.catalog(null);
    lastStatus = { text: '正在后台同步联系人与群组，可继续编辑消息', state: 'loading', retry: false };
    render();
    try {
      const next = await api.broadcastCatalog(accountId);
      if (disposed || epoch !== loadEpoch || panel !== 'broadcast-overlay' || editorOwner !== accountId || mismatch()) return;
      catalog = normalizeCatalog(next, accountId);
      editor.catalog(catalog);
      lastStatus = catalog.ready
        ? { text: catalog.chats.length ? '联系人与群组已就绪' : '当前账号暂无可发送的聊天', state: 'ready', retry: !catalog.chats.length }
        : { text: errorMessage(catalog.reasonCode || 'BROADCAST_ACCOUNT_NOT_READY'), state: 'error', retry: true };
    } catch (error) {
      if (epoch === loadEpoch && !disposed) report(error);
    } finally {
      if (epoch === loadEpoch && !disposed) { loading = false; render(); }
    }
  }

  async function openEditor() {
    if (disposed || creating || shellBusy || !apiAvailable) return;
    const account = shell?.accounts.find((item) => item.id === shell.activeId && !item.archived);
    if (!account || !['whatsapp', 'whatsapp-pure'].includes(account.platformId)) return;
    if (activeJob(account.id)) {
      await hidePanel(); panelChanged(null);
      jobsView.feedback('当前账号已有群发任务，可在任务条或群发指挥台查看。');
      $('broadcast-task-center-button').focus(); return;
    }
    stash();
    editorOwner = account.id;
    const saved = drafts.get(editorOwner);
    submission = saved?.submission || null;
    catalog = null; loading = false; editorEpoch += 1;
    lastStatus = { text: '正在后台同步联系人与群组，可继续编辑消息', state: 'loading', retry: false };
    await showPanel('broadcast-overlay', () => editor.fill(saved?.draft || emptyDraft(editorOwner), null, account), 'broadcast-message');
    panelChanged('broadcast-overlay');
    render();
    await loadCatalog();
  }

  function selectionCurrent(accountId, epoch) {
    return !disposed && panel === 'broadcast-overlay' && editorOwner === accountId
      && editorEpoch === epoch && !mismatch() && owner() && !owner().archived;
  }

  async function importContacts(kind = 'file') {
    const available = kind === 'file' ? importAvailable : kind === 'paste' ? resolveAvailable : audienceAvailable;
    if (disposed || creating || shellBusy || loading || importing || picking || removingAttachment || !available
      || panel !== 'broadcast-overlay' || mismatch() || !catalog?.ready || !owner() || owner().archived) return;
    const draft = editor.read();
    if (kind !== 'file' && audienceSourceKinds[draft.audienceMode] !== kind) return;
    const source = draft.sources[kind];
    const accountId = editorOwner;
    const epoch = editorEpoch;
    const catalogId = catalog.catalogId;
    const status = kind === 'file' ? editor.importStatus : (text, state) => editor.sourceStatus(kind, text, state);
    const current = () => {
      const latest = editor.read().sources[kind];
      return selectionCurrent(accountId, epoch) && catalog?.catalogId === catalogId && (kind === 'file'
        || latest.revision === source.revision && JSON.stringify(latest.selection) === JSON.stringify(source.selection));
    };
    try {
      const issue = kind !== 'file' && recipientSourceIssue(kind, source, catalog);
      if (issue) throw issue;
      importing = true; status(kind === 'paste' ? '正在核验号码…' : kind === 'file' ? '正在读取并核验联系人…' : '正在读取对象…', 'loading'); render();
      const result = kind === 'file' ? await api.broadcastImportContacts(accountId, catalogId)
        : kind === 'paste' ? await api.broadcastResolveRecipients(accountId, catalogId, source.selection)
          : await api.broadcastResolveAudience(accountId, catalogId, kind === 'groups'
            ? { kind, groupIds: source.selection } : { kind, labelId: source.selection });
      if (!current()) return;
      if (result === null && kind === 'file') { status(); return; }
      const imported = kind === 'file' ? normalizeImportedContacts(result, accountId) : normalizeResolvedRecipients(result, accountId, kind === 'label');
      const changedSource = kind !== 'file' && recipientSourceIssue(kind, source, imported.catalog);
      if (changedSource) throw changedSource;
      catalog = imported.catalog;
      if (kind === 'file') editor.imported(imported); else editor.resolved(kind, imported, source.revision);
      stash();
    } catch (error) {
      if (current()) status(kind === 'file' ? errorMessage(error) : audienceSourceError(error, kind), 'error');
    } finally {
      importing = false;
      if (!disposed && !current() && editorOwner === accountId) status();
      if (!disposed) render();
    }
  }

  async function pickAttachments() {
    if (disposed || creating || shellBusy || picking || removingAttachment || importing || !attachmentsAvailable
      || panel !== 'broadcast-overlay' || mismatch()) return;
    const accountId = editorOwner;
    const epoch = editorEpoch;
    const retainedIds = new Set(editor.read().attachments.map((file) => file.id));
    let picked = null;
    let accepted = false;
    try {
      if (!catalog?.ready || !catalog.capabilities.attachments) throw 'BROADCAST_ATTACHMENTS_UNAVAILABLE';
      if (editor.read().tagAll) throw 'BROADCAST_ATTACHMENTS_TAG_ALL';
      picking = true;
      editor.showAttachments(); render();
      picked = await api.broadcastPickAttachments(accountId);
      if (picked === null || !selectionCurrent(accountId, epoch)) return;
      if (!picked || picked.accountId !== accountId || !Array.isArray(picked.attachments)) throw 'BROADCAST_ATTACHMENT_INVALID';
      const draft = editor.read();
      if (draft.tagAll) throw 'BROADCAST_ATTACHMENTS_TAG_ALL';
      const next = normalizeAttachments([...draft.attachments, ...normalizeAttachments(picked.attachments)]);
      editor.attachments(next); accepted = true; stash();
      if (picked.attachments.length) lastStatus = { text: `已添加 ${picked.attachments.length} 个附件`, state: 'ready', retry: false };
    } catch (error) {
      if (selectionCurrent(accountId, epoch)) report(error);
    } finally {
      if (!accepted && Array.isArray(picked?.attachments)) {
        const ids = [...new Set(picked.attachments.map((file) => file?.id)
          .filter((id) => typeof id === 'string' && !retainedIds.has(id)))];
        if (ids.length) await api.broadcastReleaseAttachments(accountId, ids).catch(() => {});
      }
      picking = false;
      if (!disposed) render();
    }
  }

  async function removeAttachment(id) {
    if (disposed || creating || shellBusy || picking || removingAttachment || importing || !attachmentsAvailable
      || panel !== 'broadcast-overlay' || mismatch() || !editor.read().attachments.some((file) => file.id === id)) return;
    const accountId = editorOwner;
    const epoch = editorEpoch;
    removingAttachment = true; render();
    try {
      await api.broadcastReleaseAttachments(accountId, [id]);
      const saved = drafts.get(accountId);
      if (saved) saved.draft.attachments = saved.draft.attachments.filter((file) => file.id !== id);
      if (editorOwner === accountId) {
        editor.attachments(editor.read().attachments.filter((file) => file.id !== id)); stash();
      }
      if (selectionCurrent(accountId, epoch)) lastStatus = { text: '附件已移除', state: 'ready', retry: false };
    } catch (error) {
      if (selectionCurrent(accountId, epoch)) report(error);
    } finally {
      removingAttachment = false;
      if (!disposed) render();
    }
  }

  async function submit(continueEditing) {
    if (disposed || creating || shellBusy || loading || picking || removingAttachment || importing || !apiAvailable || panel !== 'broadcast-overlay') return;
    const accountId = editorOwner;
    const epoch = editorEpoch;
    try {
      if (mismatch() || !owner() || owner().archived) throw 'BROADCAST_ACCOUNT_CHANGED';
      const draft = editor.read();
      if (continueEditing && !draft.scheduleEnabled) throw 'BROADCAST_SCHEDULE_INVALID';
      const payload = draftPayload(draft, catalog);
      submission = submissionFor(payload, submission, () => (window.crypto || globalThis.crypto)?.randomUUID());
      const current = activeJob(accountId);
      if (!payload.scheduledAt && current && current.id !== submission.id) throw 'BROADCAST_ACCOUNT_BUSY';
      stash();
      creating = true;
      lastStatus = { text: continueEditing ? '正在保存定时任务…' : '正在检查并创建任务…', state: 'loading', retry: false };
      render();
      const accepted = await api.broadcastCreate({ id: submission.id, ...payload });
      if (disposed) return;
      if (!accepted?.jobId || accepted.jobId !== submission.id) throw 'BROADCAST_UNKNOWN';
      applySnapshot(accepted.snapshot);
      drafts.delete(accountId);
      submission = null;
      const stillEditing = panel === 'broadcast-overlay' && editorOwner === accountId && epoch === editorEpoch;
      if (stillEditing && continueEditing) {
        editor.clearMessage();
        lastStatus = { text: '定时任务已保存，可继续添加下一条', state: 'ready', retry: false };
        stash();
      } else if (stillEditing) {
        // A committed draft must not be stashed again by the modal-close hook.
        editorOwner = null;
        catalog = null;
        await hidePanel(); panelChanged(null);
      }
      jobsView.feedback();
    } catch (error) {
      if (!disposed) {
        report(error); stash();
        if (panel === 'broadcast-overlay' && !creating) editor.focusError(errorCode(error));
      }
    } finally {
      creating = false;
      if (!disposed) { render(); schedulePoll(); }
    }
  }

  async function control(jobId, action) {
    if (disposed || !apiAvailable || shellBusy || pendingControls.has(jobId)) return;
    pendingControls.add(jobId); jobsView.feedback(); render();
    try { applySnapshot(await api.broadcastControl(jobId, action)); }
    catch (error) {
      if (!disposed) {
        jobsView.feedback(errorMessage(error));
        if (panel === 'broadcast-overlay') report(error);
        await refreshSnapshot();
      }
    } finally { pendingControls.delete(jobId); if (!disposed) { render(); schedulePoll(); } }
  }

  async function exportFailures(accountId, jobId) {
    if (disposed || shellBusy || !exportAvailable || pendingExports.has(jobId)) return;
    const job = snapshot.jobs.find((item) => item.id === jobId && item.accountId === accountId && !item.dismissed);
    if (!hasExportableIssues(job)) return;
    pendingExports.add(jobId); jobsView.exportFeedback(accountId, jobId, '正在导出…', 'loading'); render();
    try {
      const result = await api.broadcastExportFailures(accountId, jobId);
      if (disposed) return;
      if (!result || result.accountId !== accountId || result.jobId !== jobId || typeof result.saved !== 'boolean'
        || !Number.isSafeInteger(result.revision) || result.revision < 0
        || !Number.isSafeInteger(result.rowCount) || result.rowCount < 0 || (result.saved && !result.rowCount)) {
        throw 'BROADCAST_EXPORT_FAILED';
      }
      jobsView.exportFeedback(accountId, jobId, result.saved ? `已导出 ${result.rowCount} 条异常记录` : '已取消导出', 'ready');
    } catch (error) {
      if (!disposed) jobsView.exportFeedback(accountId, jobId, errorMessage(error), 'error');
    } finally {
      pendingExports.delete(jobId);
      if (!disposed) render();
    }
  }

  async function closePanel() {
    if (creating || disposed) return;
    stash();
    await hidePanel(); panelChanged(null);
  }

  async function openTasks() {
    if (disposed || shellBusy || !apiAvailable) return;
    await showPanel('broadcast-task-center-overlay', null, 'broadcast-task-center-close');
    panelChanged('broadcast-task-center-overlay'); jobsView.opened(); await refreshSnapshot();
  }

  function panelChanged(next) {
    if (disposed || panel === next) return;
    if (panel === 'broadcast-overlay' && next !== panel) {
      stash(); editorEpoch += 1; loadEpoch += 1; loading = false;
    }
    panel = next;
    if (panel === 'broadcast-task-center-overlay') jobsView?.opened();
    schedulePoll(); render();
  }

  editor = createBroadcastEditor({ document,
    onChange: (reason) => {
      if (reason === 'audience-updated') lastStatus = { text: '发送对象已更新，排除项已保留', state: 'ready', retry: false };
      stash(); refreshEditor();
    },
    onSubmit: (continued) => track(submit(continued)), onClose: () => track(closePanel().catch(report)),
    onRetry: () => track(loadCatalog()), onControl: (id, action) => track(control(id, action)),
    onPickAttachments: () => track(pickAttachments()), onRemoveAttachment: (id) => track(removeAttachment(id)),
    onImportContacts: () => track(importContacts()),
    onResolveSource: (kind) => track(importContacts(kind)),
  });
  jobsView = createBroadcastJobs({ document, window, requestLayout,
    onOpen: () => track(openTasks().catch(report)), onClose: () => track(closePanel().catch(report)),
    onControl: (id, action) => track(control(id, action)),
    onExport: (accountId, jobId) => track(exportFailures(accountId, jobId)),
    onViewAccount: (id) => track((async () => {
      await closePanel();
      const account = [...document.querySelectorAll('.nav-account')].find((node) => node.dataset.id === id);
      const button = account?.querySelector('.nav-account-main'); button?.click(); button?.focus();
    })().catch(report)),
  });
  bind($('btn-broadcast'), 'click', () => track((async () => {
    if (panel === 'broadcast-menu') { await closePanel(); return; }
    if (creating || shellBusy || !apiAvailable) return;
    const bounds = $('btn-broadcast').getBoundingClientRect();
    await showPanel('broadcast-menu', () => {
      $('broadcast-menu').style.left = `${Math.max(4, Math.min(bounds.left || bounds.x, window.innerWidth - 220))}px`;
      $('broadcast-menu').style.top = `${(bounds.bottom || bounds.top + bounds.height) + 4}px`;
    }, 'bc-menu-send');
    panelChanged('broadcast-menu');
  })().catch(report)));
  bind($('bc-menu-send'), 'click', () => track(openEditor().catch(report)));
  bind(document, 'click', (event) => {
    if (panel === 'broadcast-menu' && !$('broadcast-menu').contains(event.target)
      && !$('btn-broadcast').contains(event.target) && !$('broadcast-task-center-button').contains(event.target)) {
      void track(closePanel().catch(report));
    }
  });
  for (const id of ['bc-menu-grouptools', 'bc-menu-export', 'bc-menu-backup', 'bc-menu-report']) unavailable($(id));

  return {
    renderShell(next) {
      if (disposed) return;
      const first = !shell;
      const previous = renderedActiveId;
      renderedActiveId = next?.activeId;
      shell = next;
      if (previous !== next?.activeId) editorEpoch += 1;
      if (previous !== next?.activeId && loading) { loadEpoch += 1; loading = false; }
      render();
      if (first || snapshot.revision < 0) void refreshSnapshot();
    },
    setShellBusy(value) { shellBusy = Boolean(value); render(); },
    panelChanged,
    get busy() { return creating; },
    async idle() { while (operations.size) await Promise.allSettled([...operations]); },
    dispose() {
      if (disposed) return;
      stash();
      disposed = true; loadEpoch += 1; editorEpoch += 1;
      if (attachmentsAvailable) for (const [accountId, saved] of drafts) {
        const ids = saved.draft.attachments?.map((file) => file.id) || [];
        if (ids.length) void api.broadcastReleaseAttachments(accountId, ids).catch(() => {});
      }
      drafts.clear();
      if (pollTimer !== null) window.clearTimeout(pollTimer);
      for (const remove of listeners) remove(); editor.dispose(); jobsView.dispose();
    },
  };
}

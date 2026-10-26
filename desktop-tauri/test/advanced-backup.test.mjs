import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, backup, deferred, turn } from './helpers/advanced-tools.mjs';
import { backupDataOf, backupPreviewOf, exportResult, historyOf } from '../frontend/models/advanced-tools.mjs';
import { DEFAULT_POLICY } from '../frontend/models/translation.mjs';

const calls = (ui, name) => ui.calls.filter(([command]) => command === name);

test('exclusion-only backup previews both kinds and restores only its explicitly present collection', async () => {
  const ui = await fixture();
  ui.setBackup(backup('a', { presets: { excludedContactIds: [] } }));
  await ui.click('bc-menu-backup'); await ui.click('at-pick-backup');
  assert.match(ui.get('at-backup-preview').textContent, /联系人排除项0清空现有/);
  assert.match(ui.get('at-backup-preview').textContent, /群组排除项—保持现有/);
  assert.equal(calls(ui, 'account_restore_backup').length, 0);
  await ui.click('at-restore-backup');
  assert.deepEqual(calls(ui, 'account_restore_backup')[0][1].data, { presets: { excludedContactIds: [] } });
  assert.deepEqual(ui.presets.get('a').excludedContactIds, []);
  assert.deepEqual(ui.presets.get('a').excludedGroupIds, ['200@g.us']);
  assert.deepEqual(ui.presets.get('b').excludedContactIds, ['101@c.us']);
  assert.equal(ui.get('at-result-presets').dataset.state, 'success');
});

test('a failed exclusion restore retains its reviewed list for an explicit retry without touching translation', async () => {
  let first = true; let ui;
  ui = await fixture({ before: (command, args) => {
    if (command === 'account_restore_backup' && first) {
      first = false; return ui.restore(args, { failPresets: 'BROADCAST_PRESET_PERSISTENCE' });
    }
  } });
  const data = { presets: { excludedContactIds: ['102@c.us'], excludedGroupIds: [] } };
  ui.setBackup(backup('a', data)); await ui.click('bc-menu-backup'); await ui.click('at-pick-backup');
  await ui.click('at-restore-backup');
  assert.deepEqual(ui.presets.get('a').excludedContactIds, ['101@c.us']);
  assert.deepEqual(ui.presets.get('a').excludedGroupIds, ['200@g.us']);
  assert.match(ui.get('at-status-backup-import').textContent, /未完成部分/);
  await ui.click('at-restore-backup');
  assert.deepEqual(calls(ui, 'account_restore_backup').at(-1)[1].data, data);
  assert.deepEqual(ui.presets.get('a').excludedContactIds, ['102@c.us']);
  assert.deepEqual(ui.presets.get('a').excludedGroupIds, []);
  assert.equal(ui.backend.accounts[0].translation.revision, 1);
});

test('backup exclusion arrays reject null, malformed and duplicate values rather than silently clearing settings', () => {
  for (const value of [null, {}, [null], [''], ['id', 'id'], ['id with spaces'], Array.from({ length: 2001 }, (_, i) => String(i))]) {
    assert.throws(() => backupDataOf({ presets: { excludedContactIds: value } }));
    assert.throws(() => backupDataOf({ presets: { excludedGroupIds: value } }));
  }
  assert.deepEqual(backupDataOf({ presets: { excludedGroupIds: [] } }), { presets: { excludedGroupIds: [] } });
});

test('backup review preserves absent versus explicitly empty collections and requires the restore button', async () => {
  const ui = await fixture();
  const chosen = backup('a', { presets: { messages: [] }, translation: { chats: {} } });
  chosen.backup.account.name = '<img src=x onerror=synthetic()>';
  ui.setBackup(chosen);
  await ui.click('bc-menu-backup'); await ui.click('at-pick-backup');
  const cards = ui.get('at-backup-preview').querySelectorAll('.at-stat').map((node) => node.textContent);
  assert.deepEqual(cards, ['常用消息0清空现有', '自定义标签—保持现有', '联系人排除项—保持现有', '群组排除项—保持现有',
    '全局翻译—保持现有', '单聊翻译0清空现有']);
  assert.match(ui.get('at-backup-preview').textContent, /保存的群组、群工具自动配置/);
  assert.match(ui.get('at-backup-preview').textContent, /不会恢复：发送历史、定时任务/);
  assert.match(ui.get('at-backup-preview').textContent, /<img src=x/);
  assert.equal(ui.get('at-backup-preview').querySelector('img'), null);
  assert.equal(calls(ui, 'account_restore_backup').length, 0);
  await ui.click('at-restore-backup');
  assert.deepEqual(calls(ui, 'account_restore_backup')[0][1], {
    accountId: 'a', expectedPresetRevision: 3, expectedTranslationRevision: 1,
    data: { presets: { messages: [] }, translation: { chats: {} } },
  });
  assert.deepEqual(ui.presets.get('a').audiences, [{ name: '原标签', recipientIds: ['100@c.us'] }]);
  assert.deepEqual(ui.backend.accounts[0].translation.global, DEFAULT_POLICY);
  assert.equal(ui.get('at-backup-preview').textContent, '');
  assert.equal(ui.get('at-restore-backup').disabled, true);
  assert.match(ui.get('at-status-backup-import').textContent, /恢复完成/);
});

test('a backup containing only unavailable keys is reviewable but cannot clear or restore unrelated settings', async () => {
  const ui = await fixture(); ui.setBackup(backup('a', {}));
  await ui.click('bc-menu-backup'); await ui.click('at-pick-backup');
  assert.equal(ui.get('at-restore-backup').disabled, true);
  assert.match(ui.get('at-status-backup-import').textContent, /未包含可恢复/);
  assert.equal(calls(ui, 'account_restore_backup').length, 0);
  assert.equal(ui.get('at-backup-preview').querySelectorAll('.at-stat').filter((node) => node.textContent.includes('保持现有')).length, 6);
});

test('cancelled or failed file selection keeps the previous reviewed backup and never writes settings', async () => {
  const ui = await fixture(); ui.setBackup(null); await ui.click('bc-menu-backup'); await ui.click('at-pick-backup');
  assert.equal(ui.get('at-status-backup-import').textContent, '已取消选择。');
  assert.equal(ui.get('at-restore-backup').disabled, true);
  ui.setBackup(backup()); await ui.click('at-pick-backup');
  const content = ui.get('at-backup-preview').textContent;
  ui.setBackup(null); await ui.click('at-pick-backup');
  assert.equal(ui.get('at-status-backup-import').textContent, '已取消本次选择，保留上次已核对的备份。');
  assert.equal(ui.get('at-backup-preview').textContent, content);
  ui.failures.set('account_pick_backup', 'BACKUP_VERSION'); await ui.click('at-pick-backup');
  assert.match(ui.get('at-status-backup-import').textContent, /版本暂不支持/);
  assert.equal(ui.get('at-backup-preview').textContent, content);
  assert.equal(ui.get('at-restore-backup').disabled, false);
  assert.equal(calls(ui, 'account_restore_backup').length, 0);
});

test('partial restore retries only the failed owner using returned revisions, retaining completed section feedback', async (t) => {
  for (const failed of ['presets', 'translation']) await t.test(failed, async () => {
    let ui; let first = true;
    ui = await fixture({ before: (command, args) => {
      if (command === 'account_restore_backup' && first) {
        first = false;
        return ui.restore(args, failed === 'presets' ? { failPresets: 'BROADCAST_PRESET_PERSISTENCE' } : { failTranslation: 'STORE_IO' });
      }
    } });
    await ui.click('bc-menu-backup'); await ui.click('at-pick-backup'); await ui.click('at-restore-backup');
    const completed = failed === 'presets' ? 'translation' : 'presets';
    assert.equal(ui.get(`at-result-${failed}`).dataset.state, 'error');
    assert.equal(ui.get(`at-result-${completed}`).dataset.state, 'success');
    assert.match(ui.get('at-status-backup-import').textContent, /重试只会恢复未完成部分/);
    assert.equal(ui.get('at-restore-backup').disabled, false);
    const expectedPresetRevision = ui.presets.get('a').revision;
    const expectedTranslationRevision = ui.backend.accounts[0].translation.revision;
    await ui.click('at-restore-backup');
    const retry = calls(ui, 'account_restore_backup')[1][1];
    assert.deepEqual(Object.keys(retry.data), [failed]);
    assert.equal(retry.expectedPresetRevision, expectedPresetRevision);
    assert.equal(retry.expectedTranslationRevision, expectedTranslationRevision);
    assert.equal(ui.get(`at-result-${completed}`).dataset.state, 'success');
    assert.equal(ui.get(`at-result-${failed}`).dataset.state, 'success');
    assert.equal(ui.get('at-restore-backup').disabled, true);
    ui.get('at-restore-backup').fire('click');
    assert.equal(calls(ui, 'account_restore_backup').length, 2);
  });
});

test('restore conflict requires another file review, while a native failure keeps the reviewed data without claiming success', async () => {
  const ui = await fixture(); await ui.click('bc-menu-backup'); await ui.click('at-pick-backup');
  ui.failures.set('account_restore_backup', 'STORE_IO'); await ui.click('at-restore-backup');
  assert.equal(ui.get('at-status-backup-import').dataset.state, 'error');
  assert.equal(ui.get('at-restore-backup').disabled, false);
  assert.ok(ui.get('at-backup-preview').textContent);
  assert.equal(ui.presets.get('a').revision, 3);
  ui.failures.clear(); ui.presets.get('a').revision = 8;
  await ui.click('at-restore-backup');
  assert.match(ui.get('at-status-backup-import').textContent, /重新选择备份文件/);
  assert.equal(ui.get('at-restore-backup').disabled, true);
  await ui.click('at-pick-backup'); await ui.click('at-restore-backup');
  assert.equal(calls(ui, 'account_restore_backup').at(-1)[1].expectedPresetRevision, 8);
  assert.match(ui.get('at-status-backup-import').textContent, /恢复完成/);
});

test('backup native export cancellation and write failure remain explicit and never expose a path', async () => {
  let cancelled = true;
  const ui = await fixture({ before: (command, args) => command === 'account_export_backup' && cancelled
    ? { accountId: args.accountId, saved: false } : undefined });
  await ui.click('bc-menu-backup'); await ui.click('at-export-backup');
  assert.equal(ui.get('at-status-backup-export').textContent, '已取消导出。');
  cancelled = false; ui.failures.set('account_export_backup', 'BACKUP_FILE_FAILED');
  await ui.click('at-export-backup'); assert.match(ui.get('at-status-backup-export').textContent, /未能读取或保存/);
  ui.failures.clear(); await ui.click('at-export-backup');
  assert.equal(ui.get('at-status-backup-export').textContent, '设置备份已导出。');
  assert.equal(calls(ui, 'account_restore_backup').length, 0);
});

test('late backup picks cannot replace a new preview after close or account ABA', async () => {
  const gate = deferred(); let first = true;
  const ui = await fixture({ before: async (command, args) => {
    if (command === 'account_pick_backup' && first) { first = false; await gate.promise; return backup(args.accountId); }
  } });
  await ui.click('bc-menu-backup'); ui.get('at-pick-backup').fire('click'); await turn();
  ui.select('b'); ui.select('a'); ui.get('at-close').fire('click'); await turn();
  ui.setBackup(backup('a', { presets: { messages: [] } }));
  ui.get('bc-menu-backup').fire('click'); await turn(); ui.get('at-pick-backup').fire('click'); await turn();
  gate.resolve(); await ui.idle();
  assert.deepEqual(ui.get('at-backup-preview').querySelectorAll('.at-stat').map((node) => node.textContent),
    ['常用消息0清空现有', '自定义标签—保持现有', '联系人排除项—保持现有', '群组排除项—保持现有',
      '全局翻译—保持现有', '单聊翻译—保持现有']);
  await ui.click('at-restore-backup');
  assert.deepEqual(calls(ui, 'account_restore_backup')[0][1].data, { presets: { messages: [] } });
});

test('a durable late restore updates only its owner and cannot replace a newer shell or another account', async () => {
  const gate = deferred(); let ui;
  ui = await fixture({ fullShell: true, before: async (command, args) => {
    if (command === 'account_restore_backup') { const result = ui.restore(args); await gate.promise; return result; }
  } });
  await ui.click('btn-broadcast'); await ui.click('bc-menu-backup'); await ui.click('at-pick-backup');
  ui.get('at-restore-backup').fire('click'); await turn();
  ui.backend.accounts[1].name = '新的乙账号名称';
  ui.backend.accounts[1].translation = { revision: 9, global: { ...DEFAULT_POLICY, target: 'es' }, chats: {} };
  ui.select('b'); await turn(); gate.resolve(); await ui.idle();
  const selected = ui.document.querySelectorAll('.nav-account').find((node) => node.dataset.id === 'b');
  assert.match(selected.textContent, /新的乙账号名称/);
  assert.equal(selected.classList.contains('active'), true);
  assert.match(ui.get('at-status-backup-import').textContent, /账号已切换/);
  assert.equal(ui.get('at-restore-backup').disabled, true);
  assert.equal(calls(ui, 'account_restore_backup').length, 1);
});

test('boundary normalization rejects mismatched owners and null or incomplete backup components without interpreting file bytes', () => {
  const chosen = backup();
  assert.throws(() => backupPreviewOf(chosen, 'b'), (error) => error === 'ADVANCED_RESPONSE_INVALID');
  for (const data of [{ presets: null }, { translation: { chats: null } }, { translation: { global: {} } },
    { presets: { messages: null } }, { presets: { messages: [], unknown: [] } }]) {
    assert.throws(() => backupDataOf(data), (error) => error === 'ADVANCED_RESPONSE_INVALID');
  }
  assert.deepEqual(backupDataOf({ presets: { audiences: [] } }), { presets: { audiences: [] } });
  assert.throws(() => exportResult({ accountId: 'a', saved: true, revision: null }, 'a', null));
  assert.throws(() => historyOf({ accountId: 'b' }, 'a'));
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ACCOUNT_ID = 'e2e-account-a';
const OTHER_ACCOUNT_ID = 'e2e-account-b';
const TASK_ID = 'e2e-scheduled-restart';
const OTHER_TASK_ID = 'e2e-scheduled-other';
const OPAQUE_ID = /^[a-f0-9]{48}$/;

function paths() {
  const userDataDir = String(process.env.GEEK_USER_DATA_DIR || '');
  assert.ok(userDataDir, 'restart E2E requires isolated userData');
  return {
    userDataDir,
    source: path.join(userDataDir, 'runtime-fixtures', 'scheduled-restart.txt'),
    handoff: path.join(userDataDir, 'runtime-fixtures', 'scheduled-restart-handoff.json'),
    store: path.join(userDataDir, 'scheduled-broadcast-attachments.json'),
  };
}

async function waitForRendererApi() {
  await browser.waitUntil(async () => browser.execute(() => Boolean(
    window.api?.file?.pick
    && window.api?.file?.release
    && window.api?.broadcastScheduled?.persist
    && window.api?.broadcastScheduled?.materialize
    && window.api?.broadcastScheduled?.cleanup
  )), { timeout: 15_000, interval: 100, timeoutMsg: 'scheduled attachment renderer API did not become ready' });
}

async function mainProcessIdentity() {
  return browser.electron.execute((electron) => ({
    pid: process.pid,
    userData: electron.app.getPath('userData'),
  }));
}

async function materializeResult(payload) {
  return browser.execute(async (input) => {
    try {
      const value = await window.api.broadcastScheduled.materialize(input);
      return { ok: true, value };
    } catch (error) {
      const message = String(error?.message || error || '');
      let category = 'OTHER';
      if (message.includes('SCHEDULED_BROADCAST_ATTACHMENT_REF_INVALID')) category = 'REF_INVALID';
      if (message.includes('SCHEDULED_BROADCAST_ATTACHMENT_CHANGED')) category = 'CHANGED';
      return { ok: false, category };
    }
  }, payload);
}

async function seed() {
  const fixture = paths();
  await waitForRendererApi();
  const identity = await mainProcessIdentity();
  assert.equal(path.resolve(identity.userData), path.resolve(fixture.userDataDir));

  const dialogMock = await browser.electron.mock('dialog', 'showOpenDialog');
  await dialogMock.mockResolvedValue({ canceled: false, filePaths: [fixture.source] });
  const picked = await browser.execute(async () => window.api.file.pick({ multiple: false }));
  assert.ok(picked && typeof picked === 'object' && !Array.isArray(picked));
  assert.deepEqual(Object.keys(picked).sort(), ['filePath', 'mime', 'name', 'size']);
  assert.match(picked.filePath, OPAQUE_ID);
  assert.equal(picked.name, 'scheduled-restart.txt');
  assert.ok(Number.isSafeInteger(picked.size) && picked.size > 0);

  const refs = await browser.execute(async (input) => window.api.broadcastScheduled.persist(input), {
    accountId: ACCOUNT_ID,
    taskId: TASK_ID,
    fileTokens: [picked.filePath],
  });
  assert.equal(Array.isArray(refs), true);
  assert.equal(refs.length, 1);
  assert.deepEqual(Object.keys(refs[0]).sort(), ['mime', 'name', 'ref', 'size']);
  assert.match(refs[0].ref, OPAQUE_ID);
  assert.notEqual(refs[0].ref, picked.filePath);
  assert.equal(refs[0].name, picked.name);
  assert.equal(refs[0].size, picked.size);
  assert.equal(refs[0].mime, picked.mime);

  const storeStat = fs.statSync(fixture.store);
  assert.equal(storeStat.isFile(), true);
  fs.writeFileSync(fixture.handoff, JSON.stringify({
    ref: refs[0].ref,
    name: refs[0].name,
    size: refs[0].size,
    mime: refs[0].mime,
    firstPid: identity.pid,
  }), { mode: 0o600 });
  console.log('E2E_SCHEDULED_RESTART_SEED persisted=true storeOnDisk=true');
}

async function verify() {
  const fixture = paths();
  const handoff = JSON.parse(fs.readFileSync(fixture.handoff, 'utf8'));
  assert.match(String(handoff.ref || ''), OPAQUE_ID);
  assert.ok(Number.isSafeInteger(handoff.firstPid) && handoff.firstPid > 0);

  await waitForRendererApi();
  const identity = await mainProcessIdentity();
  const freshProcess = identity.pid !== handoff.firstPid;
  assert.equal(freshProcess, true, 'verify phase must run in a fresh Electron main process');
  assert.equal(path.resolve(identity.userData), path.resolve(fixture.userDataDir));

  const wrongAccount = await materializeResult({ accountId: OTHER_ACCOUNT_ID, taskId: TASK_ID, refs: [handoff.ref] });
  assert.deepEqual(wrongAccount, { ok: false, category: 'REF_INVALID' });

  const wrongTask = await materializeResult({ accountId: ACCOUNT_ID, taskId: OTHER_TASK_ID, refs: [handoff.ref] });
  assert.deepEqual(wrongTask, { ok: false, category: 'REF_INVALID' });

  const restored = await materializeResult({ accountId: ACCOUNT_ID, taskId: TASK_ID, refs: [handoff.ref] });
  assert.equal(restored.ok, true);
  assert.equal(Array.isArray(restored.value), true);
  assert.equal(restored.value.length, 1);
  const materialized = restored.value[0];
  assert.deepEqual(Object.keys(materialized).sort(), ['mime', 'name', 'size', 'token']);
  assert.match(materialized.token, OPAQUE_ID);
  assert.notEqual(materialized.token, handoff.ref);
  assert.equal(materialized.name, handoff.name);
  assert.equal(materialized.size, handoff.size);
  assert.equal(materialized.mime, handoff.mime);

  const before = fs.statSync(fixture.source).size;
  fs.appendFileSync(fixture.source, 'x');
  const after = fs.statSync(fixture.source).size;
  assert.equal(after, before + 1);

  const changed = await materializeResult({ accountId: ACCOUNT_ID, taskId: TASK_ID, refs: [handoff.ref] });
  assert.deepEqual(changed, { ok: false, category: 'CHANGED' });

  const removed = await browser.execute(async (input) => window.api.broadcastScheduled.cleanup(input), {
    accountId: ACCOUNT_ID,
    taskId: TASK_ID,
  });
  assert.equal(removed, 1);

  const afterCleanup = await materializeResult({ accountId: ACCOUNT_ID, taskId: TASK_ID, refs: [handoff.ref] });
  assert.deepEqual(afterCleanup, { ok: false, category: 'REF_INVALID' });
  const released = await browser.execute(async (value) => window.api.file.release(value), materialized.token);
  assert.equal(released, 0);

  console.log('E2E_SCHEDULED_RESTART_VERIFY freshProcess=true restored=true wrongAccountBlocked=true wrongTaskBlocked=true mutationBlocked=true cleanup=true');
}

describe('scheduled attachment cross-process restart runtime gate', () => {
  it('uses two independent Electron main processes with one isolated profile', async () => {
    const phase = String(process.env.GEEK_E2E_RESTART_PHASE || '');
    if (phase === 'seed') {
      await seed();
      return;
    }
    if (phase === 'verify') {
      await verify();
      return;
    }
    throw new Error('GEEK_E2E_RESTART_PHASE_INVALID');
  });
});

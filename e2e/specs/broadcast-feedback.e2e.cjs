'use strict';

const assert = require('node:assert/strict');

const ACCOUNT_A = 'e2e-account-a';
const STEP_TIMEOUT = 3000;

async function waitVisible(selector, timeout = STEP_TIMEOUT) {
  const element = await $(selector);
  await element.waitForDisplayed({ timeout });
  return element;
}

async function waitHidden(selector, timeout = STEP_TIMEOUT) {
  const element = await $(selector);
  await browser.waitUntil(async () => !(await element.isDisplayed()), {
    timeout,
    timeoutMsg: `${selector} remained visible`,
  });
}

async function activateAccount(accountId) {
  const target = await waitVisible(`.nav-account[data-id="${accountId}"] .nav-account-main`);
  await target.click();
  await browser.waitUntil(async () => browser.execute((id) =>
    document.querySelector('.nav-account.active[data-id]')?.dataset.id === id, accountId), {
    timeout: STEP_TIMEOUT,
    timeoutMsg: `account ${accountId} did not become active`,
  });
}

async function openBroadcast() {
  await (await waitVisible('#btn-broadcast')).click();
  await waitVisible('#broadcast-menu:not(.hidden)');
  await (await waitVisible('#bc-menu-send')).click();
  await waitVisible('#broadcast-overlay:not(.hidden)', 2000);
}

describe('Broadcast non-blocking feedback', () => {
  it('keeps future-schedule persistence errors inline and renderer responsive', async () => {
    await activateAccount(ACCOUNT_A);
    await openBroadcast();

    await browser.execute(() => {
      const original = window.GeekBroadcastScheduleRegistry;
      window.__geekE2EOriginalScheduleRegistry = original;
      window.GeekBroadcastScheduleRegistry = Object.assign({}, original || {}, {
        schedulePersistenceReady: () => false,
      });

      const toggle = document.getElementById('broadcast-schedule-toggle');
      const time = document.getElementById('broadcast-schedule-time');
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      const future = new Date(Date.now() + 10 * 60 * 1000);
      time.value = new Date(future.getTime() - future.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

      window.__geekE2ESendReached = false;
      document.getElementById('broadcast-send').addEventListener('click', () => {
        window.__geekE2ESendReached = true;
      }, { once: true });
    });

    await (await waitVisible('.bc-workbench-step[data-step="review"]')).click();
    await (await waitVisible('#broadcast-send')).click();

    const blocked = await browser.execute(() => ({
      reached: window.__geekE2ESendReached,
      status: document.getElementById('broadcast-workbench-status')?.textContent || '',
      role: document.getElementById('broadcast-workbench-status')?.getAttribute('role') || '',
    }));
    assert.equal(blocked.reached, false, 'blocked schedule must not reach any downstream send handler');
    assert.match(blocked.status, /定时任务持久化尚未就绪/);
    assert.equal(blocked.role, 'status');

    await (await waitVisible('.bc-workbench-step[data-step="content"]')).click();
    const message = await waitVisible('#broadcast-message');
    await message.setValue('renderer still responsive after inline schedule error');
    assert.equal(await message.getValue(), 'renderer still responsive after inline schedule error');

    await browser.execute(() => {
      if (window.__geekE2EOriginalScheduleRegistry) {
        window.GeekBroadcastScheduleRegistry = window.__geekE2EOriginalScheduleRegistry;
      }
      delete window.__geekE2EOriginalScheduleRegistry;
    });
    await (await waitVisible('#broadcast-close')).click();
    await waitHidden('#broadcast-overlay');
  });

  it('keeps runtime start errors inline without invoking system alert', async () => {
    await activateAccount(ACCOUNT_A);
    await openBroadcast();

    await browser.waitUntil(async () => browser.execute(() =>
      typeof window.GeekBroadcastSendController?.install === 'function'
      && typeof window.GeekBroadcastRuntimeInstance?.startFromEditor === 'function'), {
      timeout: STEP_TIMEOUT,
      timeoutMsg: 'broadcast send controller/runtime did not become ready',
    });

    await browser.execute(() => {
      window.__geekE2EOriginalRuntime = window.GeekBroadcastRuntimeInstance;
      window.__geekE2EOriginalAlert = window.alert;
      window.__geekE2EAlertCount = 0;
      window.alert = () => { window.__geekE2EAlertCount += 1; };
      window.GeekBroadcastRuntimeInstance = Object.freeze({
        startFromEditor: () => Promise.reject(new Error('请先选择要发送的聊天')),
      });
      const toggle = document.getElementById('broadcast-schedule-toggle');
      if (toggle) toggle.checked = false;
    });

    await (await waitVisible('.bc-workbench-step[data-step="review"]')).click();
    await (await waitVisible('#broadcast-send')).click();
    await browser.waitUntil(async () => browser.execute(() =>
      (document.getElementById('broadcast-workbench-status')?.textContent || '').includes('请先选择要发送的聊天')), {
      timeout: STEP_TIMEOUT,
      timeoutMsg: 'runtime start error was not rendered inline',
    });

    const feedback = await browser.execute(() => {
      const status = document.getElementById('broadcast-workbench-status');
      const send = document.getElementById('broadcast-send');
      return {
        text: status?.textContent || '',
        role: status?.getAttribute('role') || '',
        live: status?.getAttribute('aria-live') || '',
        alerts: window.__geekE2EAlertCount,
        sendDisabled: !!send?.disabled,
        focusedStep: document.activeElement?.dataset?.step || '',
      };
    });
    assert.match(feedback.text, /请先选择要发送的聊天/);
    assert.equal(feedback.role, 'status');
    assert.equal(feedback.live, 'polite');
    assert.equal(feedback.alerts, 0, 'canonical runtime start errors must not invoke window.alert');
    assert.equal(feedback.sendDisabled, false, 'send button must recover after inline validation failure');
    assert.equal(feedback.focusedStep, 'audience', 'audience error should move focus to the actionable step');

    await (await waitVisible('.bc-workbench-step[data-step="content"]')).click();
    const message = await waitVisible('#broadcast-message');
    await message.setValue('renderer still responsive after runtime validation error');
    assert.equal(await message.getValue(), 'renderer still responsive after runtime validation error');

    await browser.execute(() => {
      if (window.__geekE2EOriginalRuntime) window.GeekBroadcastRuntimeInstance = window.__geekE2EOriginalRuntime;
      if (window.__geekE2EOriginalAlert) window.alert = window.__geekE2EOriginalAlert;
      delete window.__geekE2EOriginalRuntime;
      delete window.__geekE2EOriginalAlert;
      delete window.__geekE2EAlertCount;
    });
    await (await waitVisible('#broadcast-close')).click();
    await waitHidden('#broadcast-overlay');
  });
});

'use strict';

const assert = require('node:assert/strict');

const ACCOUNT_A = 'e2e-account-a';
const ACCOUNT_B = 'e2e-account-b';
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

async function installSyntheticBroadcastReadiness() {
  return browser.execute(() => {
    const marker = '__GEEK_BROADCAST_CHAT_READINESS__';
    const webviews = [...document.querySelectorAll('webview')];
    const state = { calls: 0 };
    window.__geekE2EBroadcastReadiness = state;

    for (const wv of webviews) {
      if (wv.__geekE2EReadinessPatched) continue;
      const original = wv.executeJavaScript.bind(wv);
      Object.defineProperty(wv, 'executeJavaScript', {
        configurable: true,
        value(script, ...args) {
          if (!String(script || '').includes(marker)) return original(script, ...args);
          state.calls += 1;
          const call = state.calls;
          const plans = {
            1: {
              delay: 1800,
              chats: [
                { id: 'e2e-first-group@g.us', name: 'E2E First Group', type: '群组' },
                { id: 'e2e-first-contact@c.us', name: 'E2E First Contact', type: '联系人' },
              ],
            },
            2: {
              delay: 950,
              chats: [{ id: 'e2e-stale-a@g.us', name: 'E2E STALE A', type: '群组' }],
            },
            3: {
              delay: 50,
              chats: [{ id: 'e2e-current-b@g.us', name: 'E2E CURRENT B', type: '群组' }],
            },
          };
          const plan = plans[call] || { delay: 10, chats: [] };
          return new Promise(resolve => setTimeout(() => resolve(JSON.stringify(plan.chats)), plan.delay));
        },
      });
      Object.defineProperty(wv, '__geekE2EReadinessPatched', { value: true, configurable: true });
    }
    return webviews.length;
  });
}

describe('WhatsApp broadcast first-open readiness', () => {
  it('opens immediately, recovers contacts automatically, and rejects stale account results', async () => {
    await browser.waitUntil(async () => browser.execute(() =>
      document.readyState === 'complete'
      && typeof window.GeekBroadcastChatReadiness?.install === 'function'
      && typeof window.GeekPlatformTransports?.forAccount === 'function'), {
      timeout: 10_000,
      timeoutMsg: 'broadcast readiness integration did not load',
    });

    const productionMarkerPresent = await browser.execute(() => {
      const stub = { executeJavaScript: async () => null, getWebContentsId: () => 0 };
      const adapter = window.GeekPlatformTransports.forAccount({ id: '__e2e_probe__', type: 'whatsapp' }, stub);
      return String(adapter?.transport?.getChats || '').includes('__GEEK_BROADCAST_CHAT_READINESS__');
    });
    assert.equal(productionMarkerPresent, true, 'WhatsApp transport was not patched by the production readiness module');

    await activateAccount(ACCOUNT_A);
    const patchedWebviews = await installSyntheticBroadcastReadiness();
    assert.equal(patchedWebviews, 2, 'isolated fixture must expose exactly two synthetic webviews');

    await openBroadcast();
    const loadingSnapshot = await browser.execute(() => ({
      overlayOpen: document.getElementById('broadcast-overlay')?.classList.contains('hidden') === false,
      meta: document.getElementById('broadcast-meta')?.textContent || '',
      list: document.getElementById('broadcast-list')?.textContent || '',
    }));
    assert.equal(loadingSnapshot.overlayOpen, true, 'editor must open while WhatsApp contacts are still loading');
    assert.match(loadingSnapshot.meta, /加载聊天列表/);
    assert.doesNotMatch(`${loadingSnapshot.meta}\n${loadingSnapshot.list}`, /共\s*0\s*个聊天/);

    const message = await waitVisible('#broadcast-message');
    await message.setValue('E2E draft remains editable while contacts sync');
    assert.equal(await message.getValue(), 'E2E draft remains editable while contacts sync');

    await browser.waitUntil(async () => browser.execute(() =>
      document.getElementById('broadcast-list')?.textContent?.includes('E2E First Group') === true), {
      timeout: 4500,
      timeoutMsg: 'first-open synthetic WhatsApp contacts did not recover automatically',
    });
    const firstReady = await browser.execute(() => ({
      meta: document.getElementById('broadcast-meta')?.textContent || '',
      list: document.getElementById('broadcast-list')?.textContent || '',
    }));
    assert.match(firstReady.meta, /共 2 个聊天/);
    assert.match(firstReady.list, /E2E First Group/);
    assert.match(firstReady.list, /E2E First Contact/);

    const audienceStep = await waitVisible('.bc-workbench-step[data-step="audience"]');
    await audienceStep.click();
    await (await waitVisible('#bc-selectize-control')).click();
    await waitVisible('#bc-selectize-dropdown:not(.hidden)');
    const selected = await browser.execute(() => {
      const row = [...document.querySelectorAll('#broadcast-list .broadcast-item')]
        .find(item => item.textContent.includes('E2E First Group'));
      const checkbox = row?.querySelector('input[type="checkbox"]');
      if (!checkbox) return false;
      checkbox.click();
      return checkbox.checked;
    });
    assert.equal(selected, true, 'recovered group must be selectable without reopening the editor');
    assert.equal(await browser.execute(() => window.__geekE2EBroadcastReadiness.calls), 1);

    await (await waitVisible('#broadcast-close')).click();
    await waitHidden('#broadcast-overlay');

    await activateAccount(ACCOUNT_A);
    await openBroadcast();
    assert.equal(await browser.execute(() => window.__geekE2EBroadcastReadiness.calls), 2);
    await activateAccount(ACCOUNT_B);
    await waitHidden('#broadcast-overlay');
    await openBroadcast();

    await browser.waitUntil(async () => browser.execute(() =>
      document.getElementById('broadcast-list')?.textContent?.includes('E2E CURRENT B') === true), {
      timeout: 2000,
      timeoutMsg: 'current account B result did not render',
    });
    await browser.pause(1100);
    const afterStaleA = await browser.execute(() => ({
      active: document.querySelector('.nav-account.active[data-id]')?.dataset.id || '',
      list: document.getElementById('broadcast-list')?.textContent || '',
      calls: window.__geekE2EBroadcastReadiness.calls,
    }));
    assert.equal(afterStaleA.active, ACCOUNT_B);
    assert.match(afterStaleA.list, /E2E CURRENT B/);
    assert.doesNotMatch(afterStaleA.list, /E2E STALE A/);
    assert.equal(afterStaleA.calls, 3);

    await (await waitVisible('#broadcast-close')).click();
    await waitHidden('#broadcast-overlay');
  });
});

'use strict';

// The translation popover header badge alone only says "授权异常" etc. When
// readiness is not ready, the actionable sentence must also appear under the
// popover head (visible on every tab), not only inside the collapsed
// advanced-tab "服务状态" section. When ready, the line must clear.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createNode() {
  const option = { textContent: '', dataset: {}, disabled: false };
  return {
    textContent: '',
    dataset: {},
    value: '',
    checked: false,
    classList: { contains: () => false, add() {}, remove() {}, toggle: () => false },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    appendChild() {},
    closest: () => null,
    querySelector: () => option,
    querySelectorAll: () => [],
    focus() {},
  };
}

function loadController({ readiness, health }) {
  const nodes = new Map();
  const documentStub = {
    getElementById: (id) => {
      if (!nodes.has(id)) nodes.set(id, createNode());
      return nodes.get(id);
    },
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const windowStub = {};
  const sandbox = { window: windowStub, document: documentStub, console };
  sandbox.window = windowStub;
  const code = fs.readFileSync(path.join(__dirname, '..', 'ui', 'translation-settings.js'), 'utf8');
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'translation-settings.js' });
  const controller = windowStub.GeekTranslationSettings.create({
    core: { normalizeConfig: (config) => config },
    getActiveId: () => 'account-a',
    getStorage: () => ({}),
    setStorage: async () => true,
    getCurrentChat: () => null,
    sync: () => {},
    readiness,
    health,
  });
  return { controller, node: (id) => nodes.get(id) || null };
}

(async () => {
  // Wiring pins: the header detail element must exist, start empty, and be
  // styled (hidden while empty) so a ready state adds no visual noise.
  const html = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');
  assert.match(
    html,
    /<div id="translation-service-detail" class="translation-service-detail" aria-live="polite"><\/div>\s*<div class="translation-tabs">/,
    'header detail line must sit between the popover head and the tabs',
  );
  const css = fs.readFileSync(path.join(__dirname, '..', 'ui', 'translation-settings.css'), 'utf8');
  assert.match(css, /\.translation-service-detail\s*\{/, 'header detail line must be styled');
  assert.match(css, /\.translation-service-detail:empty\s*\{\s*display:\s*none;\s*\}/, 'empty header detail line must be hidden');

  // Not ready: the actionable sentence appears under the head AND the
  // existing advanced-tab detail line keeps showing it (no regression).
  {
    const { controller, node } = loadController({
      readiness: async () => ({ ready: false, reason: 'quota-exhausted', retryable: false, quota: 'exhausted', remaining_chars: 0 }),
      health: async () => ({ ok: true }),
    });
    await controller.checkHealth(true);
    assert.equal(node('translation-service-detail').textContent, '账号：翻译额度已用完，请到个人中心开通');
    assert.match(node('translation-gateway-status').textContent, /账号：翻译额度已用完，请到个人中心开通/);
    assert.equal(node('translation-service-state').dataset.state, 'error');
  }

  // Ready: the line clears again (a stale warning must not linger).
  {
    const { controller, node } = loadController({
      readiness: async () => ({ ready: true, reason: 'ready', retryable: false, quota: 'positive', remaining_chars: 1234 }),
      health: async () => ({ ok: true }),
    });
    await controller.checkHealth(true);
    assert.equal(node('translation-service-detail').textContent, '');
    assert.equal(node('translation-service-state').textContent, '基础检查通过');
    assert.equal(node('translation-service-state').dataset.state, 'ok');
  }

  // Probe failure: the fallback sentence appears, not a blank line.
  {
    const { controller, node } = loadController({
      readiness: async () => { throw new Error('probe failed'); },
      health: async () => ({ ok: true }),
    });
    await controller.checkHealth(true);
    assert.equal(node('translation-service-detail').textContent, '账号：暂时无法取得翻译授权，请稍后重试');
  }

  // Privacy boundary: extra fields on the readiness result (token, chat
  // text) must never leak into the visible line; only the static label does.
  {
    const { controller, node } = loadController({
      readiness: async () => ({
        ready: false, reason: 'login-required', retryable: false, quota: 'unknown',
        token: 'secret-token-123', text: 'hello private chat',
      }),
      health: async () => ({ ok: true }),
    });
    await controller.checkHealth(true);
    assert.equal(node('translation-service-detail').textContent, '账号：未登录，请到个人中心登录');
    assert.doesNotMatch(node('translation-service-detail').textContent, /secret-token-123|hello private chat/);
  }

  console.log('translation-readiness-header-detail contract: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

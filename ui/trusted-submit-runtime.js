(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekTrustedSubmitRuntime = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const PROTOCOL_VERSION = 1;

  function trustedGeneration(value, field) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
      throw runtimeError('TRUSTED_SUBMIT_RUNTIME_INVALID', field);
    }
    return number;
  }

  function runtimeError(code, field = '') {
    const error = new Error(String(code || 'TRUSTED_SUBMIT_RUNTIME_FAILED'));
    error.code = String(code || 'TRUSTED_SUBMIT_RUNTIME_FAILED');
    if (field) error.field = String(field);
    return error;
  }

  function create(options = {}) {
    const authority = options.authority;
    const familyOf = options.familyOf;
    if (!authority || typeof authority.issue !== 'function' || typeof authority.consume !== 'function') {
      throw runtimeError('TRUSTED_SUBMIT_RUNTIME_INVALID', 'authority');
    }
    if (typeof familyOf !== 'function') throw runtimeError('TRUSTED_SUBMIT_RUNTIME_INVALID', 'familyOf');

    const states = new WeakMap();

    function stateFor(webview) {
      if (!webview || (typeof webview !== 'object' && typeof webview !== 'function')) {
        throw runtimeError('TRUSTED_SUBMIT_RUNTIME_INVALID', 'webview');
      }
      let state = states.get(webview);
      if (!state) {
        state = { generation: 0, composerGeneration: 0, latest: null, active: false, activePermitId: '' };
        states.set(webview, state);
      }
      return state;
    }

    function bindingFor(account, webview, state) {
      if (!account || typeof account !== 'object') throw runtimeError('TRUSTED_SUBMIT_RUNTIME_INVALID', 'account');
      const family = String(familyOf(account.type)?.key || '').trim();
      if (!family) throw runtimeError('TRUSTED_SUBMIT_RUNTIME_INVALID', 'platform');
      if (typeof webview.getWebContentsId !== 'function') {
        throw runtimeError('TRUSTED_SUBMIT_RUNTIME_INVALID', 'webviewId');
      }
      return Object.freeze({
        accountId: String(account.id || '').trim(),
        partition: String(account.partition || '').trim(),
        platform: family,
        webviewId: String(webview.getWebContentsId()),
        webviewGeneration: state.generation,
      });
    }

    function registerWebview(webview) {
      return stateFor(webview).generation;
    }

    function generationFor(webview) {
      return stateFor(webview).generation;
    }

    function composerGenerationFor(webview) {
      return stateFor(webview).composerGeneration;
    }

    function advanceGeneration(webview) {
      const state = stateFor(webview);
      state.generation += 1;
      state.composerGeneration = 0;
      state.latest = null;
      state.active = false;
      state.activePermitId = '';
      if (typeof authority.sweep === 'function') authority.sweep();
      return state.generation;
    }

    function observeComposer(account, webview, payload = {}) {
      const state = stateFor(webview);
      if (Number(payload.protocolVersion) !== PROTOCOL_VERSION) {
        throw runtimeError('TRUSTED_SUBMIT_RUNTIME_PROTOCOL');
      }
      const binding = bindingFor(account, webview, state);
      const platform = String(payload.platform || '').trim();
      if (!platform || platform !== binding.platform) {
        throw runtimeError('TRUSTED_SUBMIT_RUNTIME_PLATFORM');
      }
      const composerGeneration = trustedGeneration(payload.composerGeneration, 'composerGeneration');
      if (composerGeneration < state.composerGeneration) {
        throw runtimeError('TRUSTED_SUBMIT_RUNTIME_STALE_COMPOSER', 'composerGeneration');
      }
      if (composerGeneration > state.composerGeneration) {
        state.composerGeneration = composerGeneration;
        state.latest = null;
      }
      return Object.freeze({
        accepted: true,
        composerGeneration: state.composerGeneration,
        webviewGeneration: state.generation,
      });
    }

    function observeGesture(account, webview, payload = {}) {
      const state = stateFor(webview);
      if (Number(payload.protocolVersion) !== PROTOCOL_VERSION) {
        throw runtimeError('TRUSTED_SUBMIT_RUNTIME_PROTOCOL');
      }
      const binding = bindingFor(account, webview, state);
      const platform = String(payload.platform || '').trim();
      if (!platform || platform !== binding.platform) {
        throw runtimeError('TRUSTED_SUBMIT_RUNTIME_PLATFORM');
      }
      const kind = String(payload.kind || '').trim();
      const composerGeneration = trustedGeneration(payload.composerGeneration, 'composerGeneration');
      if (composerGeneration < state.composerGeneration) {
        throw runtimeError('TRUSTED_SUBMIT_RUNTIME_STALE_COMPOSER', 'composerGeneration');
      }
      if (composerGeneration > state.composerGeneration) {
        state.composerGeneration = composerGeneration;
        state.latest = null;
      }
      if (state.active || state.latest) throw runtimeError('TRUSTED_SUBMIT_RUNTIME_BUSY');
      const issued = authority.issue({ ...binding, kind });
      state.latest = {
        permitId: issued.permitId,
        expiresAt: issued.expiresAt,
        kind,
        composerGeneration,
        generation: state.generation,
      };
      return Object.freeze({
        accepted: true,
        kind,
        expiresAt: issued.expiresAt,
        webviewGeneration: state.generation,
        composerGeneration,
      });
    }

    function takeLatest(account, webview, expectedKind = '') {
      const state = stateFor(webview);
      const latest = state.latest;
      if (!latest) throw runtimeError('TRUSTED_SUBMIT_RUNTIME_NO_PERMIT');
      state.latest = null;
      const requestedKind = String(expectedKind || '').trim();
      if (requestedKind && requestedKind !== latest.kind) {
        throw runtimeError('TRUSTED_SUBMIT_RUNTIME_KIND_MISMATCH');
      }
      const binding = bindingFor(account, webview, state);
      if (latest.composerGeneration !== state.composerGeneration) {
        throw runtimeError('TRUSTED_SUBMIT_RUNTIME_STALE_COMPOSER', 'composerGeneration');
      }
      authority.consume(latest.permitId, binding);
      state.active = true;
      state.activePermitId = latest.permitId;
      return Object.freeze({
        permitId: latest.permitId,
        kind: latest.kind,
        webviewGeneration: state.generation,
        composerGeneration: latest.composerGeneration,
      });
    }

    function release(webview, lease) {
      const state = stateFor(webview);
      if (!lease || lease.generation !== state.generation || lease.permitId !== state.activePermitId) return false;
      state.active = false;
      state.activePermitId = '';
      state.latest = null;
      return true;
    }

    function clearWebview(webview) {
      return states.delete(webview);
    }

    return Object.freeze({
      registerWebview,
      generationFor,
      composerGenerationFor,
      advanceGeneration,
      observeComposer,
      observeGesture,
      takeLatest,
      release,
      clearWebview,
    });
  }

  return Object.freeze({ PROTOCOL_VERSION, create });
});

'use strict';

const http = require('node:http');

const DEBUG_HOST = '127.0.0.1';
const DEBUG_PORT = 9344;
const DEBUG_PATH = '/json';
const LINE_EXTENSION_ID = 'ophjlpahpchlmihnnnihgmmeilfjmjjc';
const LINE_EXTENSION_PAGE = '/index.html';
const GEEK_HOST_PAGE_SUFFIX = '/ui/index.html';
const HTTP_TIMEOUT_MS = 3000;
const CDP_TIMEOUT_MS = 5000;
const MAX_DEBUG_RESPONSE_BYTES = 1024 * 1024;

const OUTPUT_KEYS = Object.freeze([
  'pageReady',
  'tokenManagerAvailable',
  'accessTokenPresent',
  'hmacManagerAvailable',
  'hmacProduced',
  'authenticatedEventSourceAvailable',
  'pluginKeyWrapperAvailable',
  'chromeRuntimeAvailable',
]);

const SUMMARY_KEYS = Object.freeze([
  'targetCount',
  'authenticatedCount',
  'fullyReadyCount',
  'uniquePartitionCount',
  'allAuthenticated',
  'allFullyReady',
  'allPartitionsDistinct',
]);

const ALLOWED_ERROR_CODES = new Set([
  'TARGET_INDEX_INVALID',
  'DEBUG_PORT_UNAVAILABLE',
  'DEBUG_HTTP_TIMEOUT',
  'DEBUG_HTTP_STATUS_INVALID',
  'DEBUG_RESPONSE_TOO_LARGE',
  'INVALID_DEBUG_RESPONSE',
  'GEEK_HOST_TARGET_NOT_FOUND',
  'LINE_TARGET_NOT_FOUND',
  'TARGET_INDEX_OUT_OF_RANGE',
  'DEBUG_TARGET_SOCKET_INVALID',
  'WEBSOCKET_UNAVAILABLE',
  'CDP_CONNECT_FAILED',
  'CDP_CONNECT_TIMEOUT',
  'CDP_COMMAND_FAILED',
  'CDP_COMMAND_TIMEOUT',
  'PROBE_EVALUATION_FAILED',
  'PROBE_RESULT_INVALID',
]);

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function collectAuthenticatedLineState(root, documentRef) {
  const state = {
    pageReady: documentRef?.readyState === 'interactive' || documentRef?.readyState === 'complete',
    tokenManagerAvailable: false,
    accessTokenPresent: false,
    hmacManagerAvailable: false,
    hmacProduced: false,
    authenticatedEventSourceAvailable: typeof root?.GeekAuthenticatedEventSource === 'function',
    pluginKeyWrapperAvailable: typeof root?._pluginKD === 'function',
    chromeRuntimeAvailable: typeof root?.chrome?.runtime === 'object' && root.chrome.runtime !== null,
  };

  let accessToken = '';
  try {
    state.tokenManagerAvailable = typeof root?.g_plugin_enc === 'function';
    const tokenManager = state.tokenManagerAvailable ? root.g_plugin_enc() : null;
    accessToken = tokenManager?.getAccessToken?.() || '';
    state.accessTokenPresent = typeof accessToken === 'string' && accessToken.length > 0;
  } catch {
    accessToken = '';
  }

  try {
    const hmacManager = typeof root?.g_plugin_hmac === 'function' ? root.g_plugin_hmac() : null;
    state.hmacManagerAvailable = typeof hmacManager?.getHmac === 'function';
    if (state.accessTokenPresent && state.hmacManagerAvailable) {
      const hmac = await hmacManager.getHmac({
        accessToken,
        path: '/api/operation/receive',
        body: undefined,
      });
      state.hmacProduced = typeof hmac === 'string' && hmac.length > 0;
    }
  } catch {
    state.hmacProduced = false;
  }

  return state;
}

function buildProbeExpression() {
  return `(${collectAuthenticatedLineState.toString()})(window, document)`;
}

function projectProbeState(input) {
  const projected = {};
  for (const key of OUTPUT_KEYS) projected[key] = input?.[key] === true;
  return projected;
}

function formatProbeOutput(input) {
  return JSON.stringify(projectProbeState(input));
}

function projectProbeSummary(input) {
  const targetCount = Number.isSafeInteger(Number(input?.targetCount)) && Number(input.targetCount) >= 0
    ? Number(input.targetCount)
    : 0;
  const authenticatedCount = Number.isSafeInteger(Number(input?.authenticatedCount)) && Number(input.authenticatedCount) >= 0
    ? Math.min(Number(input.authenticatedCount), targetCount)
    : 0;
  const fullyReadyCount = Number.isSafeInteger(Number(input?.fullyReadyCount)) && Number(input.fullyReadyCount) >= 0
    ? Math.min(Number(input.fullyReadyCount), targetCount)
    : 0;
  const uniquePartitionCount = Number.isSafeInteger(Number(input?.uniquePartitionCount)) && Number(input.uniquePartitionCount) >= 0
    ? Math.min(Number(input.uniquePartitionCount), targetCount)
    : 0;
  return {
    targetCount,
    authenticatedCount,
    fullyReadyCount,
    uniquePartitionCount,
    allAuthenticated: targetCount > 0 && authenticatedCount === targetCount,
    allFullyReady: targetCount > 0 && fullyReadyCount === targetCount,
    allPartitionsDistinct: targetCount > 0
      && uniquePartitionCount === targetCount
      && input?.allPartitionsDistinct === true,
  };
}

function formatProbeSummary(input) {
  return JSON.stringify(projectProbeSummary(input));
}

function isLocalDebuggerSocket(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'ws:'
      && url.hostname === DEBUG_HOST
      && url.port === String(DEBUG_PORT)
      && url.pathname.startsWith('/devtools/page/');
  } catch {
    return false;
  }
}

function isGeekHostTarget(target) {
  if (!target || target.type !== 'page' || !isLocalDebuggerSocket(target.webSocketDebuggerUrl)) return false;
  try {
    const url = new URL(String(target.url || ''));
    const pathname = decodeURIComponent(url.pathname).replace(/\\/g, '/');
    return url.protocol === 'file:' && pathname.endsWith(GEEK_HOST_PAGE_SUFFIX);
  } catch {
    return false;
  }
}

function parseTargetIndex(value) {
  if (value === undefined) return 0;
  if (!/^(?:0|[1-9][0-9]*)$/.test(String(value))) throw codedError('TARGET_INDEX_INVALID');
  const index = Number(value);
  if (!Number.isSafeInteger(index)) throw codedError('TARGET_INDEX_INVALID');
  return index;
}

function buildHostBridgeExpression(targetIndex) {
  const guestExpression = JSON.stringify(buildProbeExpression());
  return `(async () => {
    const extensionId = ${JSON.stringify(LINE_EXTENSION_ID)};
    const extensionPage = ${JSON.stringify(LINE_EXTENSION_PAGE)};
    const index = ${Number(targetIndex)};
    const lineWebviews = Array.from(document.querySelectorAll('webview')).filter((webview) => {
      if (typeof webview?.executeJavaScript !== 'function') return false;
      let currentUrl = '';
      try { currentUrl = typeof webview.getURL === 'function' ? webview.getURL() : ''; } catch {}
      if (!currentUrl) {
        try { currentUrl = webview.getAttribute('src') || ''; } catch {}
      }
      try {
        const parsed = new URL(currentUrl);
        return parsed.protocol === 'chrome-extension:'
          && parsed.hostname === extensionId
          && parsed.pathname === extensionPage;
      } catch {
        return false;
      }
    });
    if (!lineWebviews.length) return { kind: 'LINE_TARGET_NOT_FOUND' };
    if (index >= lineWebviews.length) return { kind: 'TARGET_INDEX_OUT_OF_RANGE' };
    try {
      const state = await lineWebviews[index].executeJavaScript(${guestExpression}, false);
      return { kind: 'PROBE_RESULT', state };
    } catch {
      return { kind: 'PROBE_EVALUATION_FAILED' };
    }
  })()`;
}

function buildHostSummaryExpression() {
  const guestExpression = JSON.stringify(buildProbeExpression());
  const outputKeys = JSON.stringify(OUTPUT_KEYS);
  return `(async () => {
    const extensionId = ${JSON.stringify(LINE_EXTENSION_ID)};
    const extensionPage = ${JSON.stringify(LINE_EXTENSION_PAGE)};
    const outputKeys = ${outputKeys};
    const lineWebviews = Array.from(document.querySelectorAll('webview')).filter((webview) => {
      if (typeof webview?.executeJavaScript !== 'function') return false;
      let currentUrl = '';
      try { currentUrl = typeof webview.getURL === 'function' ? webview.getURL() : ''; } catch {}
      if (!currentUrl) {
        try { currentUrl = webview.getAttribute('src') || ''; } catch {}
      }
      try {
        const parsed = new URL(currentUrl);
        return parsed.protocol === 'chrome-extension:'
          && parsed.hostname === extensionId
          && parsed.pathname === extensionPage;
      } catch {
        return false;
      }
    });
    if (!lineWebviews.length) return { kind: 'LINE_TARGET_NOT_FOUND' };

    const states = await Promise.all(lineWebviews.map(async (webview) => {
      try {
        return await webview.executeJavaScript(${guestExpression}, false);
      } catch {
        return null;
      }
    }));
    const authenticatedCount = states.filter((state) =>
      state?.accessTokenPresent === true && state?.hmacProduced === true
    ).length;
    const fullyReadyCount = states.filter((state) =>
      state && outputKeys.every((key) => state[key] === true)
    ).length;
    const partitions = lineWebviews.map((webview) => {
      try { return String(webview.getAttribute('partition') || ''); } catch { return ''; }
    });
    const completePartitions = partitions.filter(Boolean);
    const uniquePartitionCount = new Set(completePartitions).size;
    return {
      kind: 'SUMMARY_RESULT',
      summary: {
        targetCount: lineWebviews.length,
        authenticatedCount,
        fullyReadyCount,
        uniquePartitionCount,
        allPartitionsDistinct: completePartitions.length === lineWebviews.length
          && uniquePartitionCount === lineWebviews.length,
      },
    };
  })()`;
}
function getDebugTargets({ httpModule = http } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (code) => {
      if (settled) return;
      settled = true;
      reject(codedError(code));
    };

    const request = httpModule.get({
      hostname: DEBUG_HOST,
      port: DEBUG_PORT,
      path: DEBUG_PATH,
      method: 'GET',
      headers: { Accept: 'application/json' },
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume?.();
        fail('DEBUG_HTTP_STATUS_INVALID');
        return;
      }

      let body = '';
      let bytes = 0;
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        if (settled) return;
        bytes += Buffer.byteLength(chunk, 'utf8');
        if (bytes > MAX_DEBUG_RESPONSE_BYTES) {
          response.destroy?.();
          fail('DEBUG_RESPONSE_TOO_LARGE');
          return;
        }
        body += chunk;
      });
      response.on('end', () => {
        if (settled) return;
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          fail('INVALID_DEBUG_RESPONSE');
          return;
        }
        if (!Array.isArray(parsed)) {
          fail('INVALID_DEBUG_RESPONSE');
          return;
        }
        settled = true;
        resolve(parsed);
      });
      response.on('error', () => fail('DEBUG_PORT_UNAVAILABLE'));
    });

    request.setTimeout?.(HTTP_TIMEOUT_MS, () => {
      request.destroy?.();
      fail('DEBUG_HTTP_TIMEOUT');
    });
    request.on('error', () => fail('DEBUG_PORT_UNAVAILABLE'));
  });
}

function evaluateTarget(target, expression, { WebSocketCtor = globalThis.WebSocket } = {}) {
  if (typeof WebSocketCtor !== 'function') return Promise.reject(codedError('WEBSOCKET_UNAVAILABLE'));
  if (!isLocalDebuggerSocket(target?.webSocketDebuggerUrl)) {
    return Promise.reject(codedError('DEBUG_TARGET_SOCKET_INVALID'));
  }

  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocketCtor(target.webSocketDebuggerUrl);
    } catch {
      reject(codedError('CDP_CONNECT_FAILED'));
      return;
    }
    const pending = new Map();
    let messageId = 0;
    let opened = false;
    let finished = false;

    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(connectTimer);
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(codedError('CDP_COMMAND_FAILED'));
      }
      pending.clear();
      try { ws.close(); } catch {}
      if (error) reject(error);
      else resolve(value);
    };

    const connectTimer = setTimeout(() => finish(codedError('CDP_CONNECT_TIMEOUT')), CDP_TIMEOUT_MS);

    const send = (method, params = {}) => new Promise((commandResolve, commandReject) => {
      const id = ++messageId;
      const timer = setTimeout(() => {
        pending.delete(id);
        commandReject(codedError('CDP_COMMAND_TIMEOUT'));
      }, CDP_TIMEOUT_MS);
      pending.set(id, { resolve: commandResolve, reject: commandReject, timer });
      try {
        ws.send(JSON.stringify({ id, method, params }));
      } catch {
        clearTimeout(timer);
        pending.delete(id);
        commandReject(codedError('CDP_COMMAND_FAILED'));
      }
    });

    ws.onmessage = (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message.id || !pending.has(message.id)) return;
      const entry = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(codedError('CDP_COMMAND_FAILED'));
      else entry.resolve(message.result);
    };

    ws.onerror = () => {
      if (!opened) finish(codedError('CDP_CONNECT_FAILED'));
    };

    ws.onclose = () => {
      if (!finished) finish(codedError(opened ? 'CDP_COMMAND_FAILED' : 'CDP_CONNECT_FAILED'));
    };

    ws.onopen = async () => {
      opened = true;
      clearTimeout(connectTimer);
      try {
        await send('Runtime.enable');
        const response = await send('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
          userGesture: false,
          includeCommandLineAPI: false,
          silent: true,
        });
        if (response?.exceptionDetails) throw codedError('PROBE_EVALUATION_FAILED');
        const value = response?.result?.value;
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw codedError('PROBE_RESULT_INVALID');
        }
        finish(null, value);
      } catch (error) {
        const code = ALLOWED_ERROR_CODES.has(error?.code) ? error.code : 'CDP_COMMAND_FAILED';
        finish(codedError(code));
      }
    };
  });
}

async function probeLineWebviewState(targets, targetIndex, options = {}) {
  const hostTarget = Array.isArray(targets) ? targets.find(isGeekHostTarget) : null;
  if (!hostTarget) throw codedError('GEEK_HOST_TARGET_NOT_FOUND');
  const result = await evaluateTarget(hostTarget, buildHostBridgeExpression(targetIndex), options);
  if (result.kind === 'LINE_TARGET_NOT_FOUND') throw codedError('LINE_TARGET_NOT_FOUND');
  if (result.kind === 'TARGET_INDEX_OUT_OF_RANGE') throw codedError('TARGET_INDEX_OUT_OF_RANGE');
  if (result.kind === 'PROBE_EVALUATION_FAILED') throw codedError('PROBE_EVALUATION_FAILED');
  if (result.kind !== 'PROBE_RESULT' || !result.state || typeof result.state !== 'object' || Array.isArray(result.state)) {
    throw codedError('PROBE_RESULT_INVALID');
  }
  return projectProbeState(result.state);
}

async function probeLineWebviewSummary(targets, options = {}) {
  const hostTarget = Array.isArray(targets) ? targets.find(isGeekHostTarget) : null;
  if (!hostTarget) throw codedError('GEEK_HOST_TARGET_NOT_FOUND');
  const result = await evaluateTarget(hostTarget, buildHostSummaryExpression(), options);
  if (result.kind === 'LINE_TARGET_NOT_FOUND') throw codedError('LINE_TARGET_NOT_FOUND');
  if (result.kind !== 'SUMMARY_RESULT' || !result.summary || typeof result.summary !== 'object' || Array.isArray(result.summary)) {
    throw codedError('PROBE_RESULT_INVALID');
  }
  return projectProbeSummary(result.summary);
}

async function main(argv = process.argv.slice(2)) {
  const selector = argv[0];
  const targets = await getDebugTargets();
  if (selector === 'all') {
    const summary = await probeLineWebviewSummary(targets);
    process.stdout.write(`${formatProbeSummary(summary)}\n`);
    return;
  }
  const targetIndex = parseTargetIndex(selector);
  const state = await probeLineWebviewState(targets, targetIndex);
  process.stdout.write(`${formatProbeOutput(state)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    const code = ALLOWED_ERROR_CODES.has(error?.code) ? error.code : 'UNKNOWN_FAILURE';
    process.stderr.write(`LINE_AUTH_REGRESSION_PROBE_FAILED:${code}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  OUTPUT_KEYS,
  SUMMARY_KEYS,
  collectAuthenticatedLineState,
  buildProbeExpression,
  buildHostBridgeExpression,
  buildHostSummaryExpression,
  projectProbeState,
  projectProbeSummary,
  formatProbeOutput,
  formatProbeSummary,
  isGeekHostTarget,
  isLocalDebuggerSocket,
  parseTargetIndex,
  getDebugTargets,
  evaluateTarget,
  probeLineWebviewState,
  probeLineWebviewSummary,
};

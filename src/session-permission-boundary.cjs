'use strict';

const {
  ACCOUNT_PARTITION_PREFIX,
  isNavigationAllowed,
} = require('./webview-navigation-boundary.cjs');

// This is intentionally much narrower than Chromium/Electron's permission vocabulary.
// Any permission not present here is denied. Each allow requires product evidence:
// - notifications are a core browser capability for all three supported chat services;
// - Telegram Web K documents fullscreen video playback, so fullscreen is Telegram-only;
// - WhatsApp Web and Telegram Web support browser calls, so camera/mic media is allowed
//   only for those account kinds and only for explicit audio/video media types;
// - LINE for Chrome explicitly does not support voice/video calls, so media stays denied.
// Clipboard read/write, display capture, speaker selection, devices, filesystem, and every
// other permission stay denied until a concrete Geek product need is independently proven.
const SUPPORTED_PERMISSION_MATRIX = Object.freeze({
  notifications: Object.freeze({ kinds: Object.freeze(['whatsapp', 'telegram', 'line']) }),
  fullscreen: Object.freeze({ kinds: Object.freeze(['telegram']) }),
  media: Object.freeze({
    kinds: Object.freeze(['whatsapp', 'telegram']),
    mediaTypes: Object.freeze(['audio', 'video']),
  }),
});

const sessionsWithPermissionHandlers = new WeakSet();

function accountLikePartition(value) {
  const partition = String(value || '');
  return partition.startsWith(ACCOUNT_PARTITION_PREFIX) ? partition : '';
}

function partitionFromSession(sessionValue) {
  if (!sessionValue) return '';
  try {
    const direct = accountLikePartition(sessionValue.partition);
    if (direct) return direct;
  } catch {}

  let storagePath = '';
  try {
    if (typeof sessionValue.storagePath === 'string') storagePath = sessionValue.storagePath;
    else if (typeof sessionValue.getStoragePath === 'function') storagePath = sessionValue.getStoragePath() || '';
  } catch {
    storagePath = '';
  }
  if (!storagePath) return '';
  const leaf = String(storagePath).split(/[\\/]/).filter(Boolean).pop() || '';
  return leaf.startsWith('webview-page-') ? `persist:${leaf}` : '';
}

function normalizeMediaTypes(value) {
  if (!Array.isArray(value)) return null;
  return value.map(item => String(item || '')).filter(Boolean);
}

function isAccountPermissionAllowed({ policy, permission, requestingUrl, mediaTypes } = {}) {
  if (!policy || !['whatsapp', 'telegram', 'line'].includes(policy.kind)) return false;
  const rule = SUPPORTED_PERMISSION_MATRIX[String(permission || '')];
  if (!rule || !rule.kinds.includes(policy.kind)) return false;
  if (!requestingUrl || !isNavigationAllowed(policy, requestingUrl)) return false;

  if (permission !== 'media') return true;

  // Permission checks in Electron do not consistently expose requested media types.
  // A check may therefore prove only account kind + trusted requesting origin. The
  // request path, when mediaTypes are supplied, additionally requires a non-empty
  // audio/video-only set. Display capture remains a distinct, denied permission.
  const normalized = normalizeMediaTypes(mediaTypes);
  if (normalized === null) return true;
  if (normalized.length === 0) return false;
  return normalized.every(type => rule.mediaTypes.includes(type));
}

function resolveDecision({ partition, resolvePolicyForPartition, permission, requestingUrl, mediaTypes }) {
  let policy = null;
  try { policy = resolvePolicyForPartition(partition) || null; } catch { policy = null; }
  return isAccountPermissionAllowed({ policy, permission, requestingUrl, mediaTypes });
}

function mediaTypesFromCheckDetails(details) {
  if (Array.isArray(details?.mediaTypes)) return details.mediaTypes;
  if (typeof details?.mediaType === 'string' && details.mediaType) return [details.mediaType];
  return undefined;
}

function installPermissionHandlersForSession({ session, partition, resolvePolicyForPartition } = {}) {
  if (!session || typeof session !== 'object') throw new TypeError('session is required');
  if (typeof resolvePolicyForPartition !== 'function') throw new TypeError('resolvePolicyForPartition is required');
  if (sessionsWithPermissionHandlers.has(session)) return false;
  if (typeof session.setPermissionRequestHandler !== 'function' || typeof session.setPermissionCheckHandler !== 'function') {
    throw new Error('SESSION_PERMISSION_HANDLER_API_UNAVAILABLE');
  }

  const fixedPartition = accountLikePartition(partition);
  if (!fixedPartition) throw new Error('SESSION_PERMISSION_PARTITION_INVALID');

  session.setPermissionRequestHandler((_webContents, permission, callback, details = {}) => {
    let allowed = false;
    try {
      const mediaTypes = permission === 'media'
        ? (Array.isArray(details.mediaTypes) ? details.mediaTypes : [])
        : undefined;
      allowed = resolveDecision({
        partition: fixedPartition,
        resolvePolicyForPartition,
        permission,
        requestingUrl: details.requestingUrl,
        mediaTypes,
      });
    } catch {
      allowed = false;
    }
    callback(Boolean(allowed));
  });

  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details = {}) => {
    try {
      return resolveDecision({
        partition: fixedPartition,
        resolvePolicyForPartition,
        permission,
        requestingUrl: requestingOrigin,
        mediaTypes: permission === 'media' ? mediaTypesFromCheckDetails(details) : undefined,
      });
    } catch {
      return false;
    }
  });

  sessionsWithPermissionHandlers.add(session);
  return true;
}

function installAccountSessionPermissionBoundary({ app, sessionModule, resolvePolicyForPartition } = {}) {
  if (!app || typeof app.on !== 'function') throw new TypeError('app.on is required');
  if (!sessionModule || typeof sessionModule.fromPartition !== 'function') throw new TypeError('sessionModule.fromPartition is required');
  if (typeof resolvePolicyForPartition !== 'function') throw new TypeError('resolvePolicyForPartition is required');
  const observedContents = new WeakSet();

  function installForPartition(partition) {
    const accountPartition = accountLikePartition(partition);
    if (!accountPartition) return false;
    const accountSession = sessionModule.fromPartition(accountPartition, { cache: true });
    installPermissionHandlersForSession({
      session: accountSession,
      partition: accountPartition,
      resolvePolicyForPartition,
    });
    return true;
  }

  app.on('web-contents-created', (_event, contents) => {
    if (!contents || observedContents.has(contents)) return;
    observedContents.add(contents);

    // Primary path: will-attach-webview runs before the remote guest can navigate or
    // request a Web permission. If an account-like partition cannot receive both
    // handlers, block attachment rather than falling back to Electron defaults.
    contents.on?.('will-attach-webview', (event, _webPreferences, params = {}) => {
      const partition = accountLikePartition(params.partition);
      if (!partition) return;
      try {
        installForPartition(partition);
      } catch {
        event?.preventDefault?.();
      }
    });

    // Defense in depth for account WebContents created by another path. The Session
    // partition compatibility layer exposes .partition on Electron 43; storagePath is
    // a fallback that also lets malformed webview-page-* partitions receive deny-only
    // handlers instead of silently inheriting Electron's default behavior.
    const partition = partitionFromSession(contents.session);
    if (!partition) return;
    try {
      installPermissionHandlersForSession({
        session: contents.session,
        partition,
        resolvePolicyForPartition,
      });
    } catch {
      try { contents.destroy?.(); } catch {}
    }
  });

  return Object.freeze({ installed: true });
}

module.exports = {
  SUPPORTED_PERMISSION_MATRIX,
  isAccountPermissionAllowed,
  installPermissionHandlersForSession,
  installAccountSessionPermissionBoundary,
};

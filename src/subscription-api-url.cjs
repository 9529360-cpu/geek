'use strict';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const UNSAFE_API_URL_CODE = 'SUBSCRIPTION_API_URL_UNSAFE';

function unsafeApiUrlError() {
  const error = new Error('订阅服务地址不安全');
  error.code = UNSAFE_API_URL_CODE;
  return error;
}

function normalizeSubscriptionApiBase(value) {
  const raw = String(value || '').trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw unsafeApiUrlError();
  }

  if (url.username || url.password || url.search || url.hash) throw unsafeApiUrlError();
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw unsafeApiUrlError();

  const hostname = String(url.hostname || '').toLowerCase();
  if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(hostname)) throw unsafeApiUrlError();

  return url.toString().replace(/\/+$/, '');
}

module.exports = {
  LOOPBACK_HOSTS,
  UNSAFE_API_URL_CODE,
  normalizeSubscriptionApiBase,
};

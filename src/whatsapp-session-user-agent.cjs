'use strict';

function isWhatsAppAccount(account) {
  return account?.type === 'whatsapp' || account?.type === 'whatsapp-pure';
}

function applyWhatsAppSessionUserAgent(options = {}) {
  const account = options.account;
  const partition = String(options.partition || '');
  const userAgent = String(options.userAgent || '').trim();
  const sessionFromPartition = options.sessionFromPartition;

  if (!isWhatsAppAccount(account)) return false;
  if (!partition || partition !== String(account.partition || '')) return false;
  if (!userAgent) throw new TypeError('userAgent is required');
  if (typeof sessionFromPartition !== 'function') throw new TypeError('sessionFromPartition is required');

  const accountSession = sessionFromPartition(partition, { cache: true });
  if (!accountSession || typeof accountSession.setUserAgent !== 'function') {
    throw new Error('WHATSAPP_SESSION_USER_AGENT_UNAVAILABLE');
  }
  accountSession.setUserAgent(userAgent);
  return true;
}

module.exports = {
  isWhatsAppAccount,
  applyWhatsAppSessionUserAgent,
};

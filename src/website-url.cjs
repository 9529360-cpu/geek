'use strict';

const ACCOUNT_WEBSITE_URL_INVALID = 'ACCOUNT_WEBSITE_URL_INVALID';

function websiteUrlError() {
  const error = new Error(ACCOUNT_WEBSITE_URL_INVALID);
  error.code = ACCOUNT_WEBSITE_URL_INVALID;
  return error;
}

function parseWebsiteUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw websiteUrlError();

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw websiteUrlError();
  }

  if (
    parsed.protocol !== 'https:'
    || !parsed.hostname
    || parsed.username
    || parsed.password
  ) {
    throw websiteUrlError();
  }

  return parsed;
}

function normalizeWebsiteUrl(value) {
  return parseWebsiteUrl(value).href;
}

module.exports = {
  ACCOUNT_WEBSITE_URL_INVALID,
  parseWebsiteUrl,
  normalizeWebsiteUrl,
};

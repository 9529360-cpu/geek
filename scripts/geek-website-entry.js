import baseWorker from './geek-website-worker.js';

const RESET_PATH = '/reset-password';
const RESET_HANDLER_MARKER = "  document.getElementById('reset-complete').onclick = async () => {";
const RESET_TOKEN_READ = "    const token = new URLSearchParams(location.search).get('token') || '';";
const RESET_TOKEN_CAPTURE = [
  "  const resetToken = new URLSearchParams(location.search).get('token') || '';",
  "  if (resetToken) history.replaceState(null, '', location.pathname);",
].join('\n');

function resetHeaders(source) {
  const headers = new Headers(source);
  headers.set('Cache-Control', 'no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  return headers;
}

function hardenResetHtml(source) {
  const html = String(source || '');
  if (!html.includes(RESET_HANDLER_MARKER) || !html.includes(RESET_TOKEN_READ)) return null;
  return html
    .replace(RESET_HANDLER_MARKER, `${RESET_TOKEN_CAPTURE}\n${RESET_HANDLER_MARKER}`)
    .replace(RESET_TOKEN_READ, '    const token = resetToken;');
}

function unavailableResetPage(response) {
  const headers = resetHeaders(response?.headers);
  headers.set('Content-Type', 'text/plain; charset=utf-8');
  return new Response('Reset page unavailable', { status: 500, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await baseWorker.fetch(request, env, ctx);
    if (request.method !== 'GET' || url.pathname !== RESET_PATH) return response;

    const headers = resetHeaders(response.headers);
    const contentType = response.headers.get('Content-Type') || '';
    if (!response.ok || !/^text\/html\b/i.test(contentType)) {
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    const hardened = hardenResetHtml(await response.text());
    if (!hardened) return unavailableResetPage(response);
    return new Response(hardened, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};

export { hardenResetHtml };

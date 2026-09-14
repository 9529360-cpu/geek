// geek-release Worker —— R2 静态发布代理（客户端自动更新从这里拉取）
// 仅公开自动更新必需产物：latest.yml、geek-setup-<version>.exe、对应 blockmap。
// 安全基线：无调试端点；错误响应不回显内部异常、R2 key 或绑定信息。
function isAllowedReleaseKey(key) {
  if (key === 'latest.yml') return true;
  if (/^geek-setup-\d+\.\d+\.\d+\.exe$/i.test(key)) return true;
  if (/^geek-setup-\d+\.\d+\.\d+\.exe\.blockmap$/i.test(key)) return true;
  return false;
}

function releaseHeaders(object, key) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', key === 'latest.yml' ? 'public, max-age=60' : 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  if (key.endsWith('.exe')) headers.set('Content-Type', 'application/octet-stream');
  if (key.endsWith('.blockmap')) headers.set('Content-Type', 'application/octet-stream');
  if (key.endsWith('.yml')) headers.set('Content-Type', 'text/yaml; charset=utf-8');
  return headers;
}

function parseSingleByteRange(value, size) {
  const header = String(value || '').trim();
  if (!header) return null;
  if (!Number.isSafeInteger(size) || size < 0) return { invalid: true };
  if (size === 0 || header.includes(',')) return { invalid: true };

  const match = header.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || (!match[1] && !match[2])) return { invalid: true };

  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { invalid: true };
    const length = Math.min(suffix, size);
    return { offset: size - length, length, end: size - 1 };
  }

  const offset = Number(match[1]);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= size) return { invalid: true };

  let end = size - 1;
  if (match[2]) {
    const requestedEnd = Number(match[2]);
    if (!Number.isSafeInteger(requestedEnd) || requestedEnd < offset) return { invalid: true };
    end = Math.min(requestedEnd, size - 1);
  }
  return { offset, length: end - offset + 1, end };
}

function rangeNotSatisfiable(object, key) {
  const headers = releaseHeaders(object, key);
  headers.set('Content-Range', `bytes */${object.size}`);
  headers.set('Content-Length', '0');
  return new Response(null, { status: 416, headers });
}

export default {
  async fetch(request, env) {
    let key;
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
      }

      const url = new URL(request.url);
      key = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'index.html';
      // 防御：拒绝路径穿越、隐藏端点、保留名以及非更新产物。
      if (
        key.includes('/') ||
        key.startsWith('.') ||
        key.startsWith('_') ||
        key === '' ||
        !isAllowedReleaseKey(key)
      ) {
        return new Response('Not Found', { status: 404 });
      }

      if (request.method === 'HEAD') {
        const object = await env.RELEASE_BUCKET.head(key);
        if (!object) return new Response('Not Found', { status: 404 });
        const headers = releaseHeaders(object, key);
        headers.set('Content-Length', String(object.size));
        return new Response(null, { status: 200, headers });
      }

      const rangeHeader = request.headers.get('Range');
      if (rangeHeader) {
        const metadata = await env.RELEASE_BUCKET.head(key);
        if (!metadata) return new Response('Not Found', { status: 404 });
        const range = parseSingleByteRange(rangeHeader, metadata.size);
        if (!range || range.invalid) return rangeNotSatisfiable(metadata, key);

        const object = await env.RELEASE_BUCKET.get(key, {
          range: { offset: range.offset, length: range.length },
        });
        if (!object) return new Response('Not Found', { status: 404 });
        const headers = releaseHeaders(object, key);
        headers.set('Content-Range', `bytes ${range.offset}-${range.end}/${metadata.size}`);
        headers.set('Content-Length', String(range.length));
        return new Response(object.body, { status: 206, headers });
      }

      const obj = await env.RELEASE_BUCKET.get(key);
      if (!obj) {
        return new Response('Not Found', { status: 404 });
      }
      const headers = releaseHeaders(obj, key);
      if (Number.isSafeInteger(obj.size) && obj.size >= 0) headers.set('Content-Length', String(obj.size));
      return new Response(obj.body, { headers });
    } catch (e) {
      // 不回显内部异常/对象 key/绑定信息
      return new Response('Worker Error', { status: 500 });
    }
  },
};

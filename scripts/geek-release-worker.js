// geek-release Worker —— R2 静态发布代理（客户端自动更新从这里拉取）
// 仅公开自动更新必需产物：latest.yml、geek-setup-<version>.exe、对应 blockmap。
// 安全基线：无调试端点；错误响应不回显内部异常、R2 key 或绑定信息。
function isAllowedReleaseKey(key) {
  if (key === 'latest.yml') return true;
  if (/^geek-setup-\d+\.\d+\.\d+\.exe$/i.test(key)) return true;
  if (/^geek-setup-\d+\.\d+\.\d+\.exe\.blockmap$/i.test(key)) return true;
  return false;
}

export default {
  async fetch(request, env) {
    let key;
    try {
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
      const obj = await env.RELEASE_BUCKET.get(key);
      if (!obj) {
        return new Response('Not Found', { status: 404 });
      }
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set('etag', obj.httpEtag);
      headers.set('Cache-Control', key === 'latest.yml' ? 'public, max-age=60' : 'public, max-age=31536000, immutable');
      headers.set('X-Content-Type-Options', 'nosniff');
      if (key.endsWith('.exe')) headers.set('Content-Type', 'application/octet-stream');
      if (key.endsWith('.blockmap')) headers.set('Content-Type', 'application/octet-stream');
      if (key.endsWith('.yml')) headers.set('Content-Type', 'text/yaml; charset=utf-8');
      return new Response(obj.body, { headers });
    } catch (e) {
      // 不回显内部异常/对象 key/绑定信息
      return new Response('Worker Error', { status: 500 });
    }
  },
};

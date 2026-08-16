// geek-release Worker —— R2 静态发布代理（客户端自动更新从这里拉取）
// 路径即对象 key：/latest.yml、/geek-setup-1.0.0.exe 等
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const key = url.pathname.replace(/^\//, '') || 'index.html';
      if (key === '__debug') {
        const bindingNames = Object.keys(env);
        const listed = await env.RELEASE_BUCKET.list({ limit: 100 });
        return new Response(JSON.stringify({
          bindings: bindingNames,
          bucketExists: typeof env.RELEASE_BUCKET,
          listedObjects: (listed.objects || []).map(o => o.key),
          truncated: listed.truncated,
          cursor: !!listed.cursor
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const obj = await env.RELEASE_BUCKET.get(key);
      if (!obj) {
        return new Response('Not Found (key=' + key + ')', { status: 404 });
      }
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set('etag', obj.httpEtag);
      headers.set('Cache-Control', 'public, max-age=60');
      if (key.endsWith('.exe')) headers.set('Content-Type', 'application/octet-stream');
      if (key.endsWith('.yml')) headers.set('Content-Type', 'text/yaml');
      return new Response(obj.body, { headers });
    } catch (e) {
      return new Response('Worker Error: ' + (e && e.message), { status: 500 });
    }
  },
};

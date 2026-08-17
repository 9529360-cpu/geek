// geek-release Worker —— R2 静态发布代理（客户端自动更新从这里拉取）
// 路径即对象 key：/latest.yml、/geek-setup-1.0.0.exe 等
// 安全基线：无调试端点；错误响应不回显内部异常、R2 key 或绑定信息。
export default {
  async fetch(request, env) {
    let key;
    try {
      const url = new URL(request.url);
      key = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'index.html';
      // 防御：拒绝路径穿越/隐藏端点/保留名；公开代理只允许普通对象 key
      if (key.includes('/') || key.startsWith('.') || key.startsWith('_') || key === '') {
        return new Response('Not Found', { status: 404 });
      }
      const obj = await env.RELEASE_BUCKET.get(key);
      if (!obj) {
        return new Response('Not Found', { status: 404 });
      }
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set('etag', obj.httpEtag);
      headers.set('Cache-Control', 'public, max-age=60');
      if (key.endsWith('.exe')) headers.set('Content-Type', 'application/octet-stream');
      if (key.endsWith('.yml')) headers.set('Content-Type', 'text/yaml');
      return new Response(obj.body, { headers });
    } catch (e) {
      // 不回显内部异常/对象 key/绑定信息
      return new Response('Worker Error', { status: 500 });
    }
  },
};

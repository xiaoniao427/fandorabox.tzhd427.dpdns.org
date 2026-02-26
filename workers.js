//反向代理目标域名
const TARGET_HOST = 'https://fandorabox.net';
const TARGET_DOMAIN = new URL(TARGET_HOST).hostname;

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  try {
    const url = new URL(request.url);
    const targetUrl = TARGET_HOST + url.pathname + url.search;

    // 创建新请求，保留原方法、body 和大部分头
    const newRequest = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'manual'
    });

    // 修改关键头部，模拟从目标域名发起的请求
    newRequest.headers.set('Host', TARGET_DOMAIN);
    newRequest.headers.set('Origin', TARGET_HOST);
    newRequest.headers.set('Referer', TARGET_HOST + '/'); // 可根据需要更精确

    // 可选：移除可能干扰的头部
    newRequest.headers.delete('X-Forwarded-For');

    // 发起请求
    const response = await fetch(newRequest);

    // 处理响应，使其对浏览器更友好
    const modifiedResponse = new Response(response.body, response);

    // 1. 重写 Set-Cookie 头，移除 Domain 限制（或改为当前 Worker 域名）
    const cookies = modifiedResponse.headers.getAll('Set-Cookie');
    if (cookies.length > 0) {
      modifiedResponse.headers.delete('Set-Cookie');
      cookies.forEach(cookie => {
        // 移除 Domain 属性（也可根据需要改为 worker 域名）
        let newCookie = cookie.replace(/;?\s*Domain=[^;]*/i, '');
        // 可选的 Secure 标记保持原样，但确保 SameSite 适当（若需要可设为 Lax/None）
        modifiedResponse.headers.append('Set-Cookie', newCookie);
      });
    }

    // 2. 处理重定向 Location
    const location = modifiedResponse.headers.get('Location');
    if (location) {
      try {
        const locationUrl = new URL(location, TARGET_HOST);
        if (locationUrl.hostname === TARGET_DOMAIN) {
          const workerUrl = new URL(request.url);
          workerUrl.pathname = locationUrl.pathname;
          workerUrl.search = locationUrl.search;
          modifiedResponse.headers.set('Location', workerUrl.toString());
        }
      } catch (e) {}
    }

    // 3. 删除 CSP 并添加 CORS（可选）
    modifiedResponse.headers.delete('Content-Security-Policy');
    modifiedResponse.headers.delete('Content-Security-Policy-Report-Only');
    modifiedResponse.headers.set('Access-Control-Allow-Origin', '*');

    return modifiedResponse;
  } catch (error) {
    return new Response('代理错误：' + error.message, { status: 500 });
  }
}

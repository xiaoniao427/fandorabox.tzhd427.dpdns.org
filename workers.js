// 反向代理目标域名
const TARGET_HOST = 'https://fandorabox.net';

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  try {
    // 1. 解析当前请求的 URL，并拼接目标地址（保留路径和查询参数）
    const url = new URL(request.url);
    const targetUrl = TARGET_HOST + url.pathname + url.search;

    // 2. 创建新的请求，继承原请求的方法、请求体和大部分头部
    const newRequest = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      // 设置重定向为 manual，以便手动处理 Location 头，避免客户端直接访问目标域名
      redirect: 'manual'
    });

    // 3. 必须修改 Host 头为目标域名，否则目标服务器可能拒绝服务
    newRequest.headers.set('Host', new URL(TARGET_HOST).hostname);

    // 可选：删除或修改可能引起问题的头部（如 Origin 或 Referer，视目标网站策略而定）
    // 这里保留原样，但若目标网站有严格防盗链，可能需要将 Referer 设置为 TARGET_HOST
    // newRequest.headers.set('Referer', TARGET_HOST);

    // 4. 发起对目标服务器的请求
    const response = await fetch(newRequest);

    // 5. 处理响应：创建可修改的响应副本
    const modifiedResponse = new Response(response.body, response);

    // 6. 处理重定向（状态码 301、302、303、307、308）
    const location = modifiedResponse.headers.get('Location');
    if (location) {
      try {
        // 将相对路径或绝对路径转换为完整的 URL（基于目标域名）
        const locationUrl = new URL(location, TARGET_HOST);
        // 仅当重定向指向目标域名时，才将其替换为当前 Worker 的地址
        if (locationUrl.hostname === new URL(TARGET_HOST).hostname) {
          const workerUrl = new URL(request.url);
          workerUrl.pathname = locationUrl.pathname;
          workerUrl.search = locationUrl.search;
          modifiedResponse.headers.set('Location', workerUrl.toString());
        }
        // 如果重定向到其他域名，则不修改，让客户端直接访问（或可根据需求决定是否阻止）
      } catch (e) {
        // location 不是合法 URL（如仅路径），无需处理
      }
    }

    // 7. 移除可能导致浏览器安全策略拦截的头部（如 CSP）
    modifiedResponse.headers.delete('Content-Security-Policy');
    modifiedResponse.headers.delete('Content-Security-Policy-Report-Only');

    // 8. 添加 CORS 头，允许任意网站跨域访问此代理（可选，根据实际需要调整）
    modifiedResponse.headers.set('Access-Control-Allow-Origin', '*');

    return modifiedResponse;
  } catch (error) {
    // 捕获并返回代理过程中的错误
    return new Response('代理错误：' + error.message, { status: 500 });
  }
}

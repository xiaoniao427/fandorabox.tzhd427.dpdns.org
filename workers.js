// 目标网站地址
const TARGET_HOST = 'fandorabox.net';
const TARGET_URL = `https://${TARGET_HOST}`;

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

/**
 * 处理请求的核心函数
 */
async function handleRequest(request) {
  try {
    // 1. 解析请求的 URL
    const url = new URL(request.url);

    // 2. 构建目标 URL（保持原始路径和查询参数）
    const targetUrl = `${TARGET_URL}${url.pathname}${url.search}`;

    // 3. 复制并修改请求头
    const headers = new Headers(request.headers);
    headers.set('Host', TARGET_HOST);

    // 4. 构建请求选项
    const requestOptions = {
      method: request.method,
      headers: headers,
      // 重要：不自动跟随重定向，避免重定向循环
      redirect: 'manual',
    };

    // 5. 发起代理请求
    const response = await fetch(targetUrl, requestOptions);

    // 6. 处理重定向
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('Location');
      if (location && !location.startsWith(TARGET_HOST)) {
        // 转发外部重定向
        const responseHeaders = new Headers(response.headers);
        responseHeaders.set('Access-Control-Allow-Origin', '*');
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders
        });
      } else {
        // 阻止自我重定向（避免循环）
        return new Response('网站不允许代理访问', {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    }

    // 7. 处理响应
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');

    // 8. 删除冲突的安全头
    responseHeaders.delete('Content-Security-Policy');
    responseHeaders.delete('X-Frame-Options');

    // 9. 返回响应
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });

  } catch (error) {
    return new Response(`代理失败: ${error.message}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

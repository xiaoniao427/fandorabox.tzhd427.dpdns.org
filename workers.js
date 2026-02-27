// 反向代理目标域名
const TARGET_HOST = 'https://fandorabox.net';
const TARGET_DOMAIN = new URL(TARGET_HOST).hostname;

// 广告代码（插入到 HTML body 尾部）
const AD_CODE = `
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4002076249242835"
     crossorigin="anonymous"></script>
<!-- 页内正方形广告 -->
<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="ca-pub-4002076249242835"
     data-ad-slot="7425310120"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>
<script>
     (adsbygoogle = window.adsbygoogle || []).push({});
</script>
`;

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  try {
    const url = new URL(request.url);

    // 1. 特殊处理 /ads.txt 请求
    if (url.pathname === '/ads.txt') {
      return new Response(
        'google.com, pub-4002076249242835, DIRECT, f08c47fec0942fa0',
        {
          status: 200,
          headers: { 'Content-Type': 'text/plain' }
        }
      );
    }

    // 2. 构造反向代理请求
    const targetUrl = TARGET_HOST + url.pathname + url.search;
    const newRequest = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'manual'
    });

    // 修改关键头部，模拟从目标域名发起的请求
    newRequest.headers.set('Host', TARGET_DOMAIN);
    newRequest.headers.set('Origin', TARGET_HOST);
    newRequest.headers.set('Referer', TARGET_HOST + '/');
    newRequest.headers.delete('X-Forwarded-For');

    // 3. 发起请求
    let response = await fetch(newRequest);

    // 4. 如果是 HTML 内容，使用 HTMLRewriter 在 <body> 尾部插入广告代码
    const contentType = response.headers.get('Content-Type') || '';
    if (contentType.includes('text/html')) {
      const rewriter = new HTMLRewriter().on('body', {
        element(element) {
          element.append(AD_CODE, { html: true }); // 在 body 内部末尾追加
        }
      });
      response = rewriter.transform(response); // response 此时变为转换后的新 Response
    }

    // 5. 包装响应以便修改头部（保持与原有代码风格一致）
    const modifiedResponse = new Response(response.body, response);

    // 6. 处理 Set-Cookie：移除 Domain 限制
    const cookies = [];
    modifiedResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        cookies.push(value);
      }
    });
    if (cookies.length > 0) {
      modifiedResponse.headers.delete('Set-Cookie');
      cookies.forEach(cookie => {
        // 移除 Domain 属性（也可根据需要改为 worker 域名）
        let newCookie = cookie.replace(/;?\s*Domain=[^;]*/i, '');
        modifiedResponse.headers.append('Set-Cookie', newCookie);
      });
    }

    // 7. 处理重定向 Location（将目标域名替换为当前 Worker 域名）
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
      } catch (e) {
        // 忽略无效 URL
      }
    }

    // 8. 删除 CSP 并添加 CORS 头（可选）
    modifiedResponse.headers.delete('Content-Security-Policy');
    modifiedResponse.headers.delete('Content-Security-Policy-Report-Only');
    modifiedResponse.headers.set('Access-Control-Allow-Origin', '*');

    return modifiedResponse;
  } catch (error) {
    return new Response('代理错误：' + error.message, { status: 500 });
  }
}

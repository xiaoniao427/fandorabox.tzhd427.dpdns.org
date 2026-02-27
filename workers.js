//代理网站主要逻辑

//引用广告相关逻辑
import { AD_CODE } from './ads.js';

const TARGET_HOST = 'https://fandorabox.net';
const TARGET_DOMAIN = new URL(TARGET_HOST).hostname;
const PROXY_DOMAIN = 'fandorabox.tzhd427.dpdns.org'; // 您的代理域名

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  try {
    const url = new URL(request.url);

    // 特殊处理 /ads.txt
    if (url.pathname === '/ads.txt') {
      return new Response(
        'google.com, pub-4002076249242835, DIRECT, f08c47fec0942fa0',
        {
          status: 200,
          headers: { 'Content-Type': 'text/plain' }
        }
      );
    }

    // 构造反向代理请求
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

    // 发起请求
    let response = await fetch(newRequest);

    // 仅对 /api/notice 的 JSON 响应进行域名替换
    if (url.pathname === '/api/notice' && 
        (response.headers.get('Content-Type') || '').includes('application/json')) {
      
      const originalJson = await response.json();
      
      // 替换 notice 内容中的特定链接
      if (originalJson.content) {
        originalJson.content = originalJson.content.replace(
          /https:\/\/fandorabox\.tzhd427\.dpdns\.org\/nopvapi/g,
          `https://${PROXY_DOMAIN}/nopvapi`
        );
      }
      
      // 重新构造 JSON 响应
      response = new Response(JSON.stringify(originalJson), {
        status: response.status,
        statusText: response.statusText,
        headers: {
          ...Object.fromEntries(response.headers),
          'Content-Type': 'application/json'
        }
      });
    }

    // 广告插入（仅 HTML）
    const contentType = response.headers.get('Content-Type') || '';
    if (contentType.includes('text/html')) {
      const rewriter = new HTMLRewriter().on('main', {
        element(element) {
          element.after(AD_CODE, { html: true });
        }
      });
      response = rewriter.transform(response);
    }

    // 包装响应以修改头部（Cookie、Location、CSP 等）
    const modifiedResponse = new Response(response.body, response);

    // 处理 Set-Cookie：移除 Domain 限制
    const cookies = [];
    modifiedResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        cookies.push(value);
      }
    });
    if (cookies.length > 0) {
      modifiedResponse.headers.delete('Set-Cookie');
      cookies.forEach(cookie => {
        let newCookie = cookie.replace(/;?\s*Domain=[^;]*/i, '');
        modifiedResponse.headers.append('Set-Cookie', newCookie);
      });
    }

    // 处理重定向 Location（域名替换）
    const location = modifiedResponse.headers.get('Location');
    if (location) {
      try {
        const locationUrl = new URL(location, TARGET_HOST);
        if (locationUrl.hostname === TARGET_DOMAIN) {
          const workerUrl = new URL(request.url);
          workerUrl.hostname = PROXY_DOMAIN;
          workerUrl.pathname = locationUrl.pathname;
          workerUrl.search = locationUrl.search;
          modifiedResponse.headers.set('Location', workerUrl.toString());
        }
      } catch (e) {
        // 忽略无效 URL
      }
    }

    // 删除 CSP 并添加 CORS 头
    modifiedResponse.headers.delete('Content-Security-Policy');
    modifiedResponse.headers.delete('Content-Security-Policy-Report-Only');
    modifiedResponse.headers.set('Access-Control-Allow-Origin', '*');

    return modifiedResponse;
  } catch (error) {
    return new Response('代理错误：' + error.message, { status: 500 });
  }
}

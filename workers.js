//代理网站主要逻辑

//引用广告相关逻辑
import { AD_CODE } from './ads.js';
//引用替换公告相关逻辑
import { getCustomNoticeResponse } from './notice-modifier.js';
//引用缓存谱面列表相关逻辑
import { handleListAllCache } from './custom-handlers.js';

const TARGET_HOST = 'https://fandorabox.net';
const TARGET_DOMAIN = new URL(TARGET_HOST).hostname;
const PROXY_DOMAIN = 'fandorabox.tzhd427.dpdns.org';

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  try {
    const url = new URL(request.url);

    // 处理缓存路径
    const listAllResponse = await handleListAllCache(request, TARGET_HOST);
    if (listAllResponse) return listAllResponse;

    // 特殊处理 /ads.txt
    if (url.pathname === '/ads.txt') {
      return new Response(
        'google.com, pub-4002076249242835, DIRECT, f08c47fec0942fa0',
        { status: 200, headers: { 'Content-Type': 'text/plain' } }
      );
    }

    // 处理 /api/notice（直接返回自定义公告）
    if (url.pathname === '/api/notice') {
      return getCustomNoticeResponse();
    }

    // 反向代理其他请求
    const targetUrl = TARGET_HOST + url.pathname + url.search;
    const newRequest = new Request(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'manual'
    });

    newRequest.headers.set('Host', TARGET_DOMAIN);
    newRequest.headers.set('Origin', TARGET_HOST);
    newRequest.headers.set('Referer', TARGET_HOST + '/');
    newRequest.headers.delete('X-Forwarded-For');

    let response = await fetch(newRequest);

    // 广告插入（仅 HTML）
    const contentType = response.headers.get('Content-Type') || '';
    if (contentType.includes('text/html')) {
      const rewriter = new HTMLRewriter().on('main', {
        element(element) { element.after(AD_CODE, { html: true }); }
      });
      response = rewriter.transform(response);
    }

    const modifiedResponse = new Response(response.body, response);

    // 处理 Set-Cookie
    const cookies = [];
    modifiedResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') cookies.push(value);
    });
    if (cookies.length) {
      modifiedResponse.headers.delete('Set-Cookie');
      cookies.forEach(cookie => {
        let newCookie = cookie.replace(/;?\s*Domain=[^;]*/i, '');
        modifiedResponse.headers.append('Set-Cookie', newCookie);
      });
    }

    // 处理重定向 Location
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
      } catch (e) {}
    }

    // 删除 CSP 并添加 CORS
    modifiedResponse.headers.delete('Content-Security-Policy');
    modifiedResponse.headers.delete('Content-Security-Policy-Report-Only');
    modifiedResponse.headers.set('Access-Control-Allow-Origin', '*');

    return modifiedResponse;
  } catch (error) {
    return new Response('代理错误：' + error.message, { status: 500 });
  }
}

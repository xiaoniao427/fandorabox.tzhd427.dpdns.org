//代理网站主要逻辑

//导入广告相关逻辑
import { AD_CODE } from './ads.js';
//导入自定义公告相关逻辑
import { getCustomNoticeResponse } from './notice-modifier.js';
//导入缓存相关逻辑
import { handleListAllCache } from './custom-handlers.js';
//导入离线暂存相关逻辑
import { handleOfflineRequest, syncToOriginalServer } from './offline-handler.js';

const TARGET_HOST = 'https://fandorabox.net';
const TARGET_DOMAIN = new URL(TARGET_HOST).hostname;
const PROXY_DOMAIN = 'fandorabox.tzhd427.dpdns.org';
const CACHE_TTL = 86400; // 24小时
const cache = caches.default;

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request, event));
});

// 定时触发器（需要配置 wrangler.toml 中的 triggers）
addEventListener('scheduled', event => {
  event.waitUntil(syncToOriginalServer(event.env));
});

async function handleRequest(request, event) {
  try {
    const url = new URL(request.url);
    const env = event.env; // 通过事件获取环境变量

    // 离线模式检查：如果 OFFLINE_MODE 为 true，优先尝试离线处理
    if (env.OFFLINE_MODE === 'true') {
      const offlineResponse = await handleOfflineRequest(request, env);
      if (offlineResponse) return offlineResponse;
    }

    // 特殊路径处理（这些路径在离线模式下可能已被拦截，但正常模式仍需处理）
    if (url.pathname === '/ads.txt') {
      return new Response(
        'google.com, pub-4002076249242835, DIRECT, f08c47fec0942fa0',
        { status: 200, headers: { 'Content-Type': 'text/plain' } }
      );
    }

    if (url.pathname === '/api/notice') {
      return getCustomNoticeResponse();
    }

    const listAllResponse = await handleListAllCache(request, TARGET_HOST);
    if (listAllResponse) return listAllResponse;

    // 根路径缓存处理
    if (url.pathname === '/' && request.method === 'GET') {
      const cacheKey = new Request(TARGET_HOST + '/', { method: 'GET' });
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) return cachedResponse;
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

    // 处理 Set-Cookie、Location、CSP（代码保持不变，省略以节省空间）
    // ...（此处粘贴原有的 Cookie、Location、CSP 处理逻辑）

    // 根路径缓存存储
    if (url.pathname === '/' && request.method === 'GET' && modifiedResponse.status === 200) {
      const responseToCache = modifiedResponse.clone();
      const newHeaders = new Headers(responseToCache.headers);
      newHeaders.set('Cache-Control', `public, max-age=${CACHE_TTL}`);
      const cachedResponse = new Response(responseToCache.body, {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers: newHeaders
      });
      await cache.put(new Request(TARGET_HOST + '/', { method: 'GET' }), cachedResponse);
    }

    return modifiedResponse;
  } catch (error) {
    return new Response('代理错误：' + error.message, { status: 500 });
  }
}

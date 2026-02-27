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

function buildBindings(env) {
  return {
    OFFLINE_MODE: env.OFFLINE_MODE === 'true',
    USER_DATA: env.USER_DATA,
    SESSIONS: env.SESSIONS,
    PENDING_SCORES: env.PENDING_SCORES
  };
}

export default {
  // 处理 HTTP 请求
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  },

  // 定时触发器（需在 wrangler.toml 中配置）
  async scheduled(event, env, ctx) {
    if (env.OFFLINE_MODE !== 'true') return;
    await syncToOriginalServer(buildBindings(env));
  }
};

async function handleRequest(request, env) {
  const bindings = buildBindings(env);
  const { OFFLINE_MODE } = bindings;

  try {
    const url = new URL(request.url);

    // 离线模式处理
    if (OFFLINE_MODE) {
      const offlineResponse = await handleOfflineRequest(request, bindings);
      if (offlineResponse) return offlineResponse;
    }

    // 特殊路径处理
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
        element(element) {
          element.after(AD_CODE, { html: true });
        }
      });
      response = rewriter.transform(response);
    }

    const modifiedResponse = new Response(response.body, response);

    // 处理 Set-Cookie：移除 Domain 限制
    const cookies = [];
    modifiedResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        cookies.push(value);
      }
    });
    if (cookies.length) {
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
      } catch (e) {}
    }

    // 删除 CSP 并添加 CORS 头
    modifiedResponse.headers.delete('Content-Security-Policy');
    modifiedResponse.headers.delete('Content-Security-Policy-Report-Only');
    modifiedResponse.headers.set('Access-Control-Allow-Origin', '*');

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

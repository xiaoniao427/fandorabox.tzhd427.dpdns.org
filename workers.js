//代理网站主要逻辑

//导入广告相关逻辑
import { AD_CODE } from './ads.js';
//导入自定义公告相关逻辑
import { getCustomNoticeResponse } from './notice-modifier.js';
//导入缓存相关逻辑
import { handleListAllCache } from './custom-handlers.js';
//导入离线暂存相关逻辑
import { handleOfflineRequest, syncToOriginalServer } from './offline-handler.js';
//导入扫码登录相关逻辑
import { handleAuthRequest } from './auth-handler.js';

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    // scheduled 事件中需要调用同步函数
    const bindings = {
      USER_DATA: env.USER_DATA,
      SESSIONS: env.SESSIONS,
      PENDING_SCORES: env.PENDING_SCORES,
      LIST_CACHE: env.LIST_CACHE,
      MACHINE_SESSIONS: env.MACHINE_SESSIONS,
      OAUTH_SESSIONS: env.OAUTH_SESSIONS,
      OFFLINE_MODE: env.OFFLINE_MODE === 'true'
    };
    const TARGET_HOST = env.ORIGIN_HOST || 'https://fandorabox.net';
    await syncToOriginalServer(bindings, TARGET_HOST);
  }
};

async function handleRequest(request, env, ctx) {
  try {
    // ========== 从环境变量获取配置 ==========
    let rawOrigin = env.ORIGIN_HOST || 'https://fandorabox.net';
    if (!rawOrigin.startsWith('http://') && !rawOrigin.startsWith('https://')) {
      rawOrigin = 'https://' + rawOrigin;
    }
    const TARGET_HOST = rawOrigin;
    const TARGET_DOMAIN = new URL(TARGET_HOST).hostname;
    const PROXY_DOMAIN = env.PROXY_DOMAIN || TARGET_DOMAIN;
    const FRONTEND_HOST = env.FRONTEND_HOST || 'https://your-frontend.com';
    const CACHE_TTL = 86400;
    const cache = caches.default;

    // KV 绑定
    const OFFLINE_MODE = env.OFFLINE_MODE === 'true';
    const SYNC_PASSWORD = env.SYNC_PASSWORD;
    const USER_DATA = env.USER_DATA;
    const SESSIONS = env.SESSIONS;
    const PENDING_SCORES = env.PENDING_SCORES;
    const LIST_CACHE = env.LIST_CACHE;
    const MACHINE_SESSIONS = env.MACHINE_SESSIONS;
    const OAUTH_SESSIONS = env.OAUTH_SESSIONS;

    const bindings = {
      OFFLINE_MODE,
      USER_DATA,
      SESSIONS,
      PENDING_SCORES,
      LIST_CACHE,
      MACHINE_SESSIONS,
      OAUTH_SESSIONS
    };

    const url = new URL(request.url);

    // ========== 处理扫码登录相关 API ==========
    const authResponse = await handleAuthRequest(request, bindings, FRONTEND_HOST);
    if (authResponse) return authResponse;

    // 手动同步端点（需密码鉴权）
    if (url.pathname === '/api/manual-sync') {
      if (!SYNC_PASSWORD) {
        return new Response(JSON.stringify({ success: false, error: 'Sync password not configured' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      const password = url.searchParams.get('password');
      if (password !== SYNC_PASSWORD) {
        return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      try {
        await syncToOriginalServer(bindings, TARGET_HOST);
        return new Response(JSON.stringify({ success: true, message: '同步完成' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

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

    // 铺面列表 - 直接返回静态数据
    // 注意：handleListAllCache 可能需要传入 LIST_CACHE 绑定，请根据实际模块调整
    const listAllResponse = await handleListAllCache(request);
    if (listAllResponse) return listAllResponse;

    // 根路径缓存
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

    // --- 开始处理响应体：域名替换和广告插入 ---
    
    // 确定当前代理域名（优先使用 PROXY_DOMAIN，否则从请求 URL 获取）
    const currentDomain = PROXY_DOMAIN || new URL(request.url).hostname;

    // 克隆响应以便读取 body
    const responseForMod = response.clone();
    const contentType = response.headers.get('Content-Type') || '';

    // 判断是否为文本类型（包括 HTML、JS、JSON、CSS、XML 等）
    const isText = contentType.startsWith('text/') || 
                   contentType.includes('javascript') || 
                   contentType.includes('json') || 
                   contentType.includes('xml') || 
                   contentType.includes('css');

    let finalResponse;

    if (isText) {
      // 读取 body 文本
      let text = await responseForMod.text();
      
      // 替换 www.fandorabox.net 为当前域名
      const targetDomainWithWww = 'www.' + TARGET_DOMAIN; // 例如 www.fandorabox.net
      const escapedTarget = targetDomainWithWww.replace(/\./g, '\\.');
      const regex = new RegExp(escapedTarget, 'g');
      const modifiedText = text.replace(regex, currentDomain);

      // 构建新的响应
      finalResponse = new Response(modifiedText, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    } else {
      finalResponse = response;
    }

    // 广告插入（仅当是 HTML）
    if (contentType.includes('text/html')) {
      const rewriter = new HTMLRewriter().on('main', {
        element(element) {
          element.after(AD_CODE, { html: true });
        }
      });
      finalResponse = rewriter.transform(finalResponse);
    }

    const modifiedResponse = finalResponse;

    // 处理 Set-Cookie（移除 Domain 属性）
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

    // 删除 CSP，添加 CORS
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

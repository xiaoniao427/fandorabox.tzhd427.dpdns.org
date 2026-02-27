/**
 * 处理 /api/maichart/list.all 的缓存逻辑（每天更新一次）
 * @param {Request} request - 原始请求对象
 * @param {string} targetHost - 目标主机，如 'https://fandorabox.net'
 * @returns {Promise<Response|null>} 如果路径匹配则返回响应，否则返回 null
 */
export async function handleListAllCache(request, targetHost) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/maichart/list.all') return null;
  if (request.method !== 'GET') return null;

  const targetUrl = targetHost + url.pathname + url.search;
  const cacheKey = new Request(targetUrl, { method: 'GET' });
  const cache = caches.default;

  // 尝试从缓存获取
  const cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) return cachedResponse;

  // 未命中，请求原站
  const newRequest = new Request(targetUrl, {
    method: 'GET',
    headers: {
      'Host': new URL(targetHost).hostname,
      'Origin': targetHost,
      'Referer': targetHost + '/',
      'User-Agent': request.headers.get('User-Agent') || 'Mozilla/5.0 (compatible; Cloudflare Worker)',
      'Accept': request.headers.get('Accept') || '*/*',
    }
  });

  try {
    const response = await fetch(newRequest);

    if (response.status === 200) {
      const responseForCache = response.clone();
      const newHeaders = new Headers(responseForCache.headers);
      newHeaders.set('Cache-Control', 'public, max-age=86400'); // 24小时
      const cachedResponseToStore = new Response(responseForCache.body, {
        status: responseForCache.status,
        statusText: responseForCache.statusText,
        headers: newHeaders
      });
      await cache.put(cacheKey, cachedResponseToStore);
    }

    return response;
  } catch (error) {
    return new Response('代理错误：' + error.message, { status: 502 });
  }
}

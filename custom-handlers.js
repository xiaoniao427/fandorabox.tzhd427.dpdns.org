// 从全局获取 KV 绑定
const LIST_CACHE = globalThis.LIST_CACHE;

// 检查源站是否在线（HEAD 请求首页）
async function isOriginOnline() {
  try {
    const response = await fetch('https://fandorabox.net/', { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

// 获取暂存的曲目列表
async function getStoredList() {
  const stored = await LIST_CACHE.get('list_data', 'json');
  return stored || null; // stored 应包含 { data, timestamp }
}

// 更新曲目列表（从源站获取并存入 KV）
async function updateList() {
  try {
    const response = await fetch('https://fandorabox.net/api/maichart/list.all', {
      headers: {
        'User-Agent': 'Cloudflare Worker',
        'Accept': 'application/json',
      }
    });
    if (!response.ok) return null;

    const data = await response.json();
    const timestamp = Date.now();
    await LIST_CACHE.put('list_data', JSON.stringify({ data, timestamp }));
    return { data, timestamp };
  } catch {
    return null;
  }
}

// 处理 /api/maichart/list.all 请求
export async function handleListAllCache(request) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/maichart/list.all') return null;
  if (request.method !== 'GET') return null;

  const now = Date.now();
  const ONE_DAY = 86400000; // 24小时毫秒数

  // 获取暂存数据
  const stored = await getStoredList();

  // 判断是否需要更新：有缓存且未过期且源站在线
  const needUpdate = !stored || (now - stored.timestamp > ONE_DAY && await isOriginOnline());

  let resultData;
  if (needUpdate) {
    const updated = await updateList();
    if (updated) {
      resultData = updated.data;
    } else {
      // 更新失败（源站问题），如果有旧缓存则使用旧缓存，否则返回错误
      if (stored) {
        resultData = stored.data;
      } else {
        return new Response(JSON.stringify({ error: 'Service unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
  } else {
    // 不需要更新，直接使用缓存（可能已过期但源站离线）
    resultData = stored ? stored.data : null;
    if (!resultData) {
      return new Response(JSON.stringify({ error: 'No data available' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  // 返回成功响应
  return new Response(JSON.stringify(resultData), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache' // 避免被 Cloudflare CDN 缓存
    }
  });
}

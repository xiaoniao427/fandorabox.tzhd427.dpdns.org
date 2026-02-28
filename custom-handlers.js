import { SONGS_LIST } from './songs-data.js';

/**
 * 处理 /api/maichart/list.all 请求
 * 直接从 songs-data.js 返回静态数据
 */
export async function handleListAllCache(request) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/maichart/list.all') return null;
  if (request.method !== 'GET') return null;

  return new Response(JSON.stringify(SONGS_LIST), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600' // 客户端/边缘缓存1小时
    }
  });
}

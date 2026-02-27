// 模拟离线状态的请求处理器
export async function handleOfflineRequest(request, env) {
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname;

  // 1. 模拟注册接口返回 404
  if (path === '/api/machine/register') {
    return new Response('Not Found', { status: 404 });
  }

  // 2. 模拟登录接口
  if (path === '/api/account/login' && method === 'POST') {
    const formData = await request.formData();
    const username = formData.get('username');
    const password = formData.get('password'); // 加密后的密码

    if (!username) {
      return new Response('Bad Request', { status: 400 });
    }

    // 生成模拟的 connect.sid（实际生产应使用更安全的方式）
    const fakeSessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2)}`;
    
    // 存储用户凭证到 KV（用于后续同步）
    await env.USER_DATA.put(`cred:${username}`, password, { expirationTtl: 30 * 86400 }); // 30天

    // 存储会话映射
    await env.SESSIONS.put(fakeSessionId, username, { expirationTtl: 7 * 86400 }); // 7天

    const responseBody = {
      username: username,
      isAdmin: false,
      avatarUrl: `/api/account/Avatar/${username}`
    };

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `connect.sid=${fakeSessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`
      }
    });
  }

  // 3. 模拟获取用户信息（依赖 Cookie）
  if (path === '/api/account/info') {
    const cookie = request.headers.get('Cookie') || '';
    const match = cookie.match(/connect\.sid=([^;]+)/);
    if (!match) {
      return new Response('Unauthorized', { status: 401 });
    }

    const sessionId = match[1];
    const username = await env.SESSIONS.get(sessionId);
    if (!username) {
      return new Response('Unauthorized', { status: 401 });
    }

    return new Response(JSON.stringify({
      username: username,
      isAdmin: false,
      avatarUrl: `/api/account/Avatar/${username}`
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 4. 模拟获取头像（返回固定图片）
  if (path.startsWith('/api/account/icon')) {
    // 从查询参数获取用户名，但本实现忽略用户名，返回固定图片
    const fixedAvatarUrl = 'https://free.picui.cn/free/2026/02/27/69a12cc36a7c5.png';
    const imageResponse = await fetch(fixedAvatarUrl);
    const imageBlob = await imageResponse.blob();
    
    return new Response(imageBlob, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400'
      }
    });
  }

  // 5. 模拟互动接口
  if (path.match(/^\/api\/maichart\/[^\/]+\/interact$/)) {
    return new Response(JSON.stringify({
      IsLiked: false,
      LikeCount: 0,
      Likes: []
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 6. 模拟成绩上传（暂存数据）
  if (path.match(/^\/api\/maichart\/[^\/]+\/score$/) && method === 'POST') {
    const cookie = request.headers.get('Cookie') || '';
    const match = cookie.match(/connect\.sid=([^;]+)/);
    if (!match) {
      return new Response('Unauthorized', { status: 401 });
    }

    const sessionId = match[1];
    const username = await env.SESSIONS.get(sessionId);
    if (!username) {
      return new Response('Unauthorized', { status: 401 });
    }

    // 获取歌曲ID
    const songId = path.split('/')[3]; // 格式：/api/maichart/{songId}/score
    const scoreData = await request.json();

    // 暂存成绩到 KV，键名包含用户名以便同步
    const scoreKey = `score:${username}:${songId}:${Date.now()}`;
    await env.PENDING_SCORES.put(scoreKey, JSON.stringify({
      songId,
      username,
      scoreData,
      timestamp: new Date().toISOString()
    }));

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 7. 模拟登出
  if (path === '/api/account/logout' && method === 'POST') {
    const cookie = request.headers.get('Cookie') || '';
    const match = cookie.match(/connect\.sid=([^;]+)/);
    if (match) {
      const sessionId = match[1];
      await env.SESSIONS.delete(sessionId);
    }

    return new Response(JSON.stringify({ logout: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'connect.sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
      }
    });
  }

  // 不是模拟接口，返回 null 让主流程继续
  return null;
}

/**
 * 同步暂存数据到原站（应通过定时触发器调用）
 * @param {Object} env - Worker 环境变量
 */
export async function syncToOriginalServer(env) {
  // 检查原站是否在线
  try {
    const healthCheck = await fetch('https://fandorabox.net/api/health', { method: 'HEAD' });
    if (!healthCheck.ok) return; // 原站仍离线
  } catch {
    return; // 原站离线
  }

  console.log('原站已恢复，开始同步数据...');

  // 获取所有需要同步的用户凭证和暂存成绩
  const credList = await env.USER_DATA.list({ prefix: 'cred:' });
  const pendingScoresList = await env.PENDING_SCORES.list({ prefix: 'score:' });

  // 按用户分组暂存成绩
  const scoresByUser = {};
  for (const key of pendingScoresList.keys) {
    const parts = key.name.split(':');
    const username = parts[1];
    if (!scoresByUser[username]) scoresByUser[username] = [];
    const scoreData = await env.PENDING_SCORES.get(key.name, 'json');
    scoresByUser[username].push(scoreData);
  }

  // 对每个有暂存数据的用户进行登录和上传
  for (const credKey of credList.keys) {
    const username = credKey.name.replace('cred:', '');
    const password = await env.USER_DATA.get(credKey.name);

    // 尝试登录原站获取真实 Cookie
    const loginForm = new FormData();
    loginForm.append('username', username);
    loginForm.append('password', password);

    const loginResponse = await fetch('https://fandorabox.net/api/account/login', {
      method: 'POST',
      body: loginForm
    });

    if (!loginResponse.ok) continue;

    // 获取原站返回的 Cookie（注意原站可能返回多个 Cookie）
    const originalCookies = loginResponse.headers.get('Set-Cookie');

    // 上传该用户的暂存成绩
    const userScores = scoresByUser[username] || [];
    for (const score of userScores) {
      const scoreUrl = `https://fandorabox.net/api/maichart/${score.songId}/score`;
      await fetch(scoreUrl, {
        method: 'POST',
        headers: {
          'Cookie': originalCookies,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(score.scoreData)
      });
    }

    // 清理已同步的数据
    for (const score of userScores) {
      await env.PENDING_SCORES.delete(`score:${username}:${score.songId}:${score.timestamp}`);
    }
  }

  console.log('数据同步完成');
}

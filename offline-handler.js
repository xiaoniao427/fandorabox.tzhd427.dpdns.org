export async function handleOfflineRequest(request, bindings) {
  const { USER_DATA, SESSIONS, PENDING_SCORES } = bindings;
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

    const fakeSessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2)}`;
    await USER_DATA.put(`cred:${username}`, password, { expirationTtl: 30 * 86400 });
    await SESSIONS.put(fakeSessionId, username, { expirationTtl: 7 * 86400 });

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
    if (!match) return new Response('Unauthorized', { status: 401 });

    const sessionId = match[1];
    const username = await SESSIONS.get(sessionId);
    if (!username) return new Response('Unauthorized', { status: 401 });

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
    if (!match) return new Response('Unauthorized', { status: 401 });

    const sessionId = match[1];
    const username = await SESSIONS.get(sessionId);
    if (!username) return new Response('Unauthorized', { status: 401 });

    const songId = path.split('/')[3];
    const scoreData = await request.json();

    const ts = Date.now();
    const scoreKey = `score:${username}:${songId}:${ts}`;
    await PENDING_SCORES.put(scoreKey, JSON.stringify({
      songId,
      username,
      scoreData,
      keyTimestamp: ts
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
      await SESSIONS.delete(sessionId);
    }

    return new Response(JSON.stringify({ logout: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'connect.sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
      }
    });
  }

  // 非模拟接口，返回 null
  return null;
}

/**
 * 同步暂存数据到原站（应通过定时触发器调用）
 */
export async function syncToOriginalServer(bindings) {
  const { USER_DATA, PENDING_SCORES } = bindings;

  // 检查原站是否在线
  try {
    const healthCheck = await fetch('https://fandorabox.net/api/health', { method: 'HEAD' });
    if (!healthCheck.ok) return;
  } catch {
    return;
  }

  console.log('原站已恢复，开始同步数据...');

  const credList = await USER_DATA.list({ prefix: 'cred:' });
  const pendingScoresList = await PENDING_SCORES.list({ prefix: 'score:' });

  // 按用户分组暂存成绩
  const scoresByUser = {};
  for (const key of pendingScoresList.keys) {
    const parts = key.name.split(':');
    const username = parts[1];
    if (!scoresByUser[username]) scoresByUser[username] = [];
    const scoreData = await PENDING_SCORES.get(key.name, 'json');
    scoresByUser[username].push(scoreData);
  }

  for (const credKey of credList.keys) {
    const username = credKey.name.replace('cred:', '');
    const password = await USER_DATA.get(credKey.name);

    // 尝试登录原站获取真实 Cookie
    const loginForm = new FormData();
    loginForm.append('username', username);
    loginForm.append('password', password);

    const loginResponse = await fetch('https://fandorabox.net/api/account/login', {
      method: 'POST',
      body: loginForm
    });

    if (!loginResponse.ok) continue;

    const originalCookies = loginResponse.headers.get('Set-Cookie');

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

      // 清理已同步的数据
      await PENDING_SCORES.delete(`score:${username}:${score.songId}:${score.keyTimestamp}`);
    }
  }

  console.log('数据同步完成');
}

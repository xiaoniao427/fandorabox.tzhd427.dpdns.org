// 离线请求处理器（仅保留离线接口模拟）
export async function handleOfflineRequest(request, bindings) {
  const { USER_DATA, SESSIONS, PENDING_SCORES } = bindings;
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname;

  // ---- 离线接口模拟逻辑 ----
  if (path === '/api/machine/register') {
    return new Response('Not Found', { status: 404 });
  }

  if (path === '/api/account/login' && method === 'POST') {
    const formData = await request.formData();
    const username = formData.get('username');
    const password = formData.get('password');
    if (!username) return new Response('Bad Request', { status: 400 });

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

if (path.match(/^\/api\/maichart\/[^\/]+\/score$/) && method === 'POST') {
    const cookie = request.headers.get('Cookie') || '';
    const match = cookie.match(/connect\.sid=([^;]+)/);
    if (!match) return new Response('Unauthorized', { status: 401 });
    const sessionId = match[1];
    const username = await SESSIONS.get(sessionId);
    if (!username) return new Response('Unauthorized', { status: 401 });

const songId = path.split('/')[3];
  const scoreData = await request.json();
  const timestamp = new Date().toISOString(); // 统一为 ISO 字符串
  const scoreKey = `score:${username}:${songId}:${timestamp}`;
  await PENDING_SCORES.put(scoreKey, JSON.stringify({
    songId,
    username,
    scoreData,
    timestamp  // 存储相同的 ISO 字符串

    return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
      
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

  // 非离线接口返回 null，由主流程继续
  return null;
}

// 同步函数（仅成绩上传）
export async function syncToOriginalServer(bindings) {
  const { USER_DATA, SESSIONS, PENDING_SCORES } = bindings;

  console.log('开始尝试同步成绩数据...');

  const credList = await USER_DATA.list({ prefix: 'cred:' });
  const pendingScoresList = await PENDING_SCORES.list({ prefix: 'score:' });

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

    const loginForm = new FormData();
    loginForm.append('username', username);
    loginForm.append('password', password);
    const loginResponse = await fetch('https://fandorabox.net/api/account/login', {
      method: 'POST',
      body: loginForm
    });

    if (!loginResponse.ok) continue;

    const cookies = [];
    loginResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        const sidMatch = value.match(/connect\.sid=[^;]+/);
        if (sidMatch) cookies.push(sidMatch[0]);
      }
    });
    const originalCookieHeader = cookies.join('; ');

    const userScores = scoresByUser[username] || [];
    for (const score of userScores) {
      const scoreUrl = `https://fandorabox.net/api/maichart/${score.songId}/score`;
      try {
        const uploadRes = await fetch(scoreUrl, {
          method: 'POST',
          headers: {
            'Cookie': originalCookieHeader,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(score.scoreData)
        });
        if (uploadRes.ok) {
          await PENDING_SCORES.delete(`score:${username}:${score.songId}:${score.timestamp}`);
          console.log(`Uploaded score for ${username} successfully`);
        } else {
          console.error(`Failed to upload score for ${username}: ${uploadRes.status}`);
        }
      } catch (e) {
        console.error(`Error uploading score for ${username}:`, e);
      }
    }
  }

  console.log('成绩同步尝试完成');
}

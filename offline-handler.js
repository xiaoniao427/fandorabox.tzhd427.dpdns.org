// 辅助函数：提取请求信息
async function extractRequestInfo(request) {
  const url = new URL(request.url);
  const headers = {};
  const safeHeaders = ['cookie', 'content-type', 'user-agent', 'referer', 'origin'];
  request.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (safeHeaders.includes(lowerKey) || lowerKey.startsWith('x-')) {
      headers[key] = value;
    }
  });

  let body = null;
  let bodyType = null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const clonedReq = request.clone();
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      body = await clonedReq.text();
      bodyType = 'json';
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      body = await clonedReq.text();
      bodyType = 'form';
    } else {
      try {
        body = await clonedReq.text();
        bodyType = 'text';
      } catch {
        // 忽略无法读取的 body
      }
    }
  }

  let sessionId = null;
  const cookie = headers['cookie'] || '';
  const match = cookie.match(/connect\.sid=([^;]+)/);
  if (match) sessionId = match[1];

  return {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    body,
    bodyType,
    sessionId,
    timestamp: Date.now()
  };
}

// 记录请求到 KV（异步）
async function logRequest(request, bindings, event) {
  try {
    const info = await extractRequestInfo(request);
    const key = `req:${info.timestamp}:${Math.random().toString(36).substr(2, 8)}`;
    await bindings.PENDING_REQUESTS.put(key, JSON.stringify(info));
  } catch (e) {
    console.error('Failed to log request:', e);
  }
}

// 离线请求处理器（包含原有接口逻辑 + 请求记录）
export async function handleOfflineRequest(request, bindings, event) {
  const { USER_DATA, SESSIONS, PENDING_SCORES, PENDING_REQUESTS } = bindings;
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname;

  // 异步记录请求
  if (event) {
    event.waitUntil(logRequest(request.clone(), bindings, event));
  }

  // ---- 原有离线接口逻辑（保持不变）----
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

    const ts = Date.now();
    const suffix = Math.random().toString(36).slice(2, 8);
    const scoreKey = `score:${username}:${songId}:${ts}:${suffix}`;
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

// 同步函数（每30分钟触发一次，不再检查原站在线状态）
export async function syncToOriginalServer(bindings) {
  const { USER_DATA, SESSIONS, PENDING_SCORES, PENDING_REQUESTS } = bindings;

  console.log('开始尝试同步数据（无论原站是否在线）...');

  // ---- 回放请求记录 ----
  const reqList = await PENDING_REQUESTS.list({ prefix: 'req:' });
  reqList.keys.sort((a, b) => a.name.localeCompare(b.name)); // 按时间正序

  for (const key of reqList.keys) {
    const reqInfo = await PENDING_REQUESTS.get(key.name, 'json');
    if (!reqInfo) continue;

    let cookieHeader = '';
    if (reqInfo.sessionId) {
      const username = await SESSIONS.get(reqInfo.sessionId);
      if (username) {
        const password = await USER_DATA.get(`cred:${username}`);
        if (password) {
          const loginForm = new FormData();
          loginForm.append('username', username);
          loginForm.append('password', password);
          const loginRes = await fetch('https://fandorabox.net/api/account/login', {
            method: 'POST',
            body: loginForm
          });
          if (loginRes.ok) {
            const cookies = [];
            loginRes.headers.forEach((value, key) => {
              if (key.toLowerCase() === 'set-cookie') {
                const sidMatch = value.match(/connect\.sid=[^;]+/);
                if (sidMatch) cookies.push(sidMatch[0]);
              }
            });
            cookieHeader = cookies.join('; ');
          }
        }
      }
    }

    const targetUrl = `https://fandorabox.net${reqInfo.url}`;
    const headers = new Headers(reqInfo.headers || {});
    if (cookieHeader) {
      headers.set('Cookie', cookieHeader);
    } else {
      headers.delete('Cookie');
    }
    headers.delete('host');

    const fetchOptions = {
      method: reqInfo.method,
      headers: headers
    };

    if (reqInfo.body && reqInfo.method !== 'GET' && reqInfo.method !== 'HEAD') {
      fetchOptions.body = reqInfo.body;
      if (!headers.has('content-type') && reqInfo.bodyType) {
        if (reqInfo.bodyType === 'json') {
          headers.set('content-type', 'application/json');
        } else if (reqInfo.bodyType === 'form') {
          headers.set('content-type', 'application/x-www-form-urlencoded');
        }
      }
    }

    try {
      const response = await fetch(targetUrl, fetchOptions);
      if (response.ok) {
        await PENDING_REQUESTS.delete(key.name);
        console.log(`Replayed request ${key.name} successfully`);
      } else {
        console.error(`Failed to replay request ${key.name}: ${response.status}`);
      }
    } catch (e) {
      console.error(`Error replaying request ${key.name}:`, e);
    }
  }

  // ---- 原有的成绩同步逻辑 ----
  const credList = await USER_DATA.list({ prefix: 'cred:' });
  const pendingScoresList = await PENDING_SCORES.list({ prefix: 'score:' });

  // 按用户分组暂存成绩，保留原始 KV key 用于删除
  const scoresByUser = {};
  for (const key of pendingScoresList.keys) {
    const parts = key.name.split(':');
    const username = parts[1];
    if (!scoresByUser[username]) scoresByUser[username] = [];
    const scoreData = await PENDING_SCORES.get(key.name, 'json');
    if (
      !scoreData ||
      typeof scoreData !== 'object' ||
      Array.isArray(scoreData) ||
      !scoreData.songId ||
      !scoreData.scoreData
    ) {
      console.warn(`跳过无效暂存记录: ${key.name}`);
      continue;
    }
    scoresByUser[username].push({ ...scoreData, _kvKey: key.name });
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
      if (!score.songId || !score.scoreData) {
        console.warn(`跳过字段缺失的成绩记录: ${score._kvKey || 'unknown'}`);
        continue;
      }
      const scoreUrl = `https://fandorabox.net/api/maichart/${score.songId}/score`;

      let uploadOk = false;
      try {
        const res = await fetch(scoreUrl, {
          method: 'POST',
          headers: {
            'Cookie': originalCookies,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(score.scoreData)
        });
        uploadOk = res.ok;
        if (!uploadOk) {
          console.warn(`上传成绩失败 (${res.status}): ${score._kvKey || score.songId}`);
        }
      } catch (err) {
        console.error(`上传成绩异常: ${score._kvKey || score.songId}`, err);
      }

      // 仅在上传成功时清理暂存数据
      if (uploadOk) {
        try {
          if (score._kvKey) {
            await PENDING_SCORES.delete(score._kvKey);
          } else {
            // 兼容旧记录：尝试 keyTimestamp 和 timestamp 两种格式
            if (score.keyTimestamp) {
              await PENDING_SCORES.delete(`score:${username}:${score.songId}:${score.keyTimestamp}`);
            }
            if (score.timestamp) {
              await PENDING_SCORES.delete(`score:${username}:${score.songId}:${score.timestamp}`);
            }
          }
        } catch (delErr) {
          console.error(`删除暂存记录失败: ${score._kvKey || score.songId}`, delErr);
        }
      }
    }
  }

  console.log('同步尝试完成');
}

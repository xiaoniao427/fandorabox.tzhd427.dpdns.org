// 自定义公告内容（您提供的文本）
const CUSTOM_NOTICE_CONTENT = `
（此为代理站，原站地址：fandorabox.net）
（本站目前仍处于早期试验阶段）FANdoraBOX，或者说fanNET，也就是给你看这条公告的网站，是由FANdoraxxx建立的一个谱面下载站和游玩分数上传/存储站（与MajdataPlay工作）。原站完全不盈利，服务器和网络等成本均由原站作者一人承担且不接受捐赠，也因此无法保证网站上任何内容的可靠性，持久性，安全性（但是咱会尽力的……）。
如果你对本站的使用有任何大大或小小疑惑，可以通过以下任意方式联系原站作者（如果是关于连接至majplay的疑问，建议先看教程/加入QQ群）：
QQ账号：187299431 Gmail：takamichika666@gmail.com QQ Mail：187299431@qq.com
在游玩时PV下载速度十分缓慢的玩家可以使用无PV的api：https://fandorabox.tzhd427.dpdns.org/nopvapi
Android版本用户初次安装后需要自己补齐skins，下载资源链接中的skins后解压至游戏根目录
`.trim(); // 移除首尾空白，保留内部换行

/**
 * 处理公告响应：将 content 字段替换为自定义文本
 * @param {Response} response - 原始响应对象
 * @returns {Promise<Response>} 修改后的响应对象
 */
export async function modifyNoticeResponse(response) {
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    return response; // 非 JSON 直接返回
  }

  try {
    const originalJson = await response.json();
    
    // 构造新 JSON，保留原 updatedAt 和 updatedBy（如果存在），否则使用默认值
    const modifiedJson = {
      content: CUSTOM_NOTICE_CONTENT,
      updatedAt: originalJson.updatedAt || new Date().toISOString(),
      updatedBy: originalJson.updatedBy || 'FANdoraxxx'
    };

    // 创建新响应
    const newResponse = new Response(JSON.stringify(modifiedJson), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
    newResponse.headers.set('Content-Type', 'application/json');
    return newResponse;
  } catch (error) {
    console.error('修改公告响应时出错:', error);
    return response; // 出错时返回原始响应
  }
}

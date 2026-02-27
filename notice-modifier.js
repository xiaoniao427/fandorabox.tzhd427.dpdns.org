// 自定义公告内容
const CUSTOM_NOTICE_CONTENT = `
（此为代理站，原站地址：https://fandorabox.net ）
（本站目前仍处于早期试验阶段）FANdoraBOX，或者说fanNET，也就是给你看这条公告的网站，是由FANdoraxxx建立的一个谱面下载站和游玩分数上传/存储站（与MajdataPlay工作）。原站完全不盈利，服务器和网络等成本均由原站作者一人承担且不接受捐赠，也因此无法保证网站上任何内容的可靠性，持久性，安全性（但是咱会尽力的……）。
如果你对本站的使用有任何大大或小小疑惑，可以通过以下任意方式联系原站作者（如果是关于连接至majplay的疑问，建议先看教程/加入QQ群）：
QQ账号：187299431 Gmail：takamichika666@gmail.com QQ Mail：187299431@qq.com
常规api（包含PV）：https://fandorabox.tzhd427.dpdns.org/api
在游玩时PV下载速度十分缓慢的玩家可以使用无PV的api：https://fandorabox.tzhd427.dpdns.org/nopvapi
Android版本用户初次安装后需要自己补齐skins，下载资源链接中的skins后解压至游戏根目录
`.trim();

/**
 * 直接返回自定义公告响应（不依赖原站）
 * @returns {Response} 包含自定义公告的 JSON 响应
 */
export function getCustomNoticeResponse() {
  const noticeData = {
    content: CUSTOM_NOTICE_CONTENT,
    updatedAt: new Date().toISOString(), // 动态更新时间
    updatedBy: 'FANdoraxxx'
  };

  return new Response(JSON.stringify(noticeData), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*', // 允许跨域（如有需要）
      'Cache-Control': 'no-cache' // 防止缓存旧公告
    }
  });
}

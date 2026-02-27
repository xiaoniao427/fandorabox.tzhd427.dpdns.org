# MajdataPlay 反向代理 Worker

这是一个为 Majdata.net 设计的 Cloudflare Workers 反向代理项目，提供了多种增强功能，包括广告插入、公告自定义、离线模拟、数据缓存与同步等。通过此 Worker，您可以在代理原站内容的同时，灵活控制特定接口的行为，并在原站离线时维持基本服务能力。
>其实本来是给FandoraBOX写的，后来发现api接口只要是支持MajdataPlay就能用
---

## 功能特性

- 反向代理
    将 你的网站 的请求透明转发至 目标网站，并自动处理跨域、Cookie 域限制、重定向域名替换等。
- 广告插入
    在代理的 HTML 页面中，于 <main> 元素后自动插入指定的 Google AdSense 广告代码。
- 自定义公告
    拦截 /api/notice 请求，直接返回您指定的公告 JSON，不再依赖原站内容。
- 离线模拟模式
    通过环境变量 OFFLINE_MODE 控制，当设为 true 时，模拟原站离线状态，对特定 API 返回预设响应，并利用 KV 存储用户会话、暂存成绩，待原站恢复后自动同步。
- API 数据缓存
    对 /api/maichart/list.all 进行每日缓存（24小时），减少对原站的请求压力。
- 根页面缓存
    对根路径 / 同样进行每日缓存，提升访问速度。
- 特殊文件处理
  - /ads.txt 返回广告验证文本。
  - 自动移除响应中的 Content-Security-Policy 头，添加 Access-Control-Allow-Origin: *。
- Cookie 处理
    移除 Set-Cookie 中的 Domain 属性，使其能在代理域名下正常使用。
- 重定向重写
    将原站返回的 Location 头中的域名替换为代理域名，确保跳转仍通过 Worker。

---

## 部署前准备

1. Cloudflare 账户 并已启用 Workers。
2. 创建三个 KV 命名空间（用于离线模式）：
   · USER_DATA：存储用户加密密码。
   · SESSIONS：存储离线会话映射。
   · PENDING_SCORES：暂存用户上传的成绩。
3. 准备您的广告代码（已在 ads.js 中预设，可按需修改）。
4. 准备自定义公告内容（在 notice-modifier.js 中修改 CUSTOM_NOTICE_CONTENT 变量）。

---

## 配置说明

环境变量（通过 wrangler.toml 或 Dashboard 设置）

变量名 类型 说明
OFFLINE_MODE string 设为 "true" 启用离线模拟模式，否则正常代理。

KV 命名空间绑定

在 wrangler.toml 中添加：

```toml
[[kv_namespaces]]
binding = "USER_DATA"
id = "your_user_data_kv_id"

[[kv_namespaces]]
binding = "SESSIONS"
id = "your_sessions_kv_id"

[[kv_namespaces]]
binding = "PENDING_SCORES"
id = "your_pending_scores_kv_id"
```

定时触发器（可选，用于自动同步暂存数据）

```toml
[triggers]
crons = ["0 */6 * * *"]   # 每6小时尝试同步一次
```

---

## 文件结构

```
.
├── worker.js              # 主程序
├── ads.js                 # 广告代码模块
├── notice-modifier.js     # 公告替换模块
├── custom-handlers.js     # 缓存处理器（/api/maichart/list.all）
├── offline-handler.js     # 离线模拟处理器
└── README.md              # 本文档
```

---

## 部署步骤

方式一：使用 Wrangler CLI

1. 安装并登录 Wrangler：
   ```bash
   npm install -g wrangler
   wrangler login
   ```
2. 在项目目录下创建 wrangler.toml，配置名称、KV 绑定、环境变量等（参考下方示例）。
3. 发布 Worker：
   ```bash
   wrangler deploy
   ```

方式二：通过 Cloudflare Dashboard 手动上传

1. 在 Workers 页面创建新 Worker，选择“快速编辑”。
2. 将各模块代码分别以“附加模块”形式上传（worker.js 为主模块）。
3. 在“设置”中添加 KV 命名空间绑定和环境变量。
4. 部署。

wrangler.toml 配置示例

```toml
name = "fandorabox-proxy"
main = "worker.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "USER_DATA"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

[[kv_namespaces]]
binding = "SESSIONS"
id = "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"

[[kv_namespaces]]
binding = "PENDING_SCORES"
id = "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"

[vars]
OFFLINE_MODE = "false"

[triggers]
crons = ["0 */6 * * *"]
```

---

## 使用方法

正常代理模式

· 设置 OFFLINE_MODE = "false"。
· 访问 https://fandorabox.tzhd427.dpdns.org 即可浏览原站内容，页面底部将显示广告。
· 公告将显示您在 notice-modifier.js 中定义的内容。
· 曲目列表接口 /api/maichart/list.all 每天更新一次。
· 根路径 / 每天更新一次。

离线模拟模式

· 设置 OFFLINE_MODE = "true"。
· 以下 API 将返回模拟响应，不依赖原站：
  路径 行为
  /api/machine/register 返回 404
  /api/account/login (POST) 模拟登录，生成会话 Cookie，存储用户凭证
  /api/account/info 根据 Cookie 返回用户信息
  /api/account/icon?username=xxx 返回固定头像图片
  /api/maichart/*/interact 返回 {"IsLiked":false,"LikeCount":0,"Likes":[]}
  /api/maichart/*/score (POST) 暂存成绩至 KV，返回 {"ok":true}
  /api/account/logout 清除会话 Cookie
· 当原站恢复后，Worker 会通过定时任务自动登录并上传暂存的成绩（使用原站返回的真实 Cookie）。

---

注意事项

1. KV 计费：离线模式会频繁读写 KV，请注意免费层用量限制。
2. Cookie 安全：离线模式下生成的 connect.sid 仅用于本地会话，无实际加密保障，请勿用于生产环境。
3. 健康检查端点：同步任务需要原站提供 /api/health 端点（返回 2xx 状态码），您可根据实际情况修改检查路径。
4. 广告代码：ads.js 中的广告单元 ID 需替换为您自己的 Google AdSense 代码。
5. 公告文本：notice-modifier.js 中的 CUSTOM_NOTICE_CONTENT 变量可按需修改。
6. 缓存时间：根路径和曲目列表的缓存时间均为 86400 秒（1天），可根据需要调整 CACHE_TTL 常量。
7. 域名替换：Worker 会自动将响应内容中的 fandorabox.net 替换为您的代理域名，确保站内链接正确。

---

## 自定义扩展

您可以根据需要修改或添加新的路径处理逻辑：

· 在 offline-handler.js 中增加更多模拟接口。
· 在 custom-handlers.js 中添加其他 API 的缓存策略。
· 在 worker.js 中调整广告插入位置（例如改为 body 或特定元素）。

---

## 许可证

本项目采用 GNU General Public License v3.0（GPLv3）。

- 强制开源：任何分发或派生作品必须提供源代码，且同样以 GPLv3 许可。
- 沿用许可证：修改后的版本必须继续使用 GPLv3，确保自由传播。
- 允许商业使用：GPLv3 不禁止商业销售，但要求销售时必须同时提供完整的源代码。
- 禁止附加限制：不得对软件使用者施加进一步的限制（如专利报复条款）。

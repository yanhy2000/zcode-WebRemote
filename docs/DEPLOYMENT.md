# ZCode Remote 部署与自建指南

本文档介绍如何在各种环境下部署 `zcode-remote` 服务端。

---

## 环境变量配置

| 变量名 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `PORT` | `8765` | 服务监听端口。 |
| `HOST` | `0.0.0.0` | 服务监听 IP。**几乎总是保持 `0.0.0.0`**：Docker 端口映射和反向代理都要经容器网卡进来，设成 `127.0.0.1` 会导致宿主机 `curl` 和 nginx 全部 502。只有在本机直接跑、且确认只给本机进程访问时才改成 `127.0.0.1`。 |
| `STATIC_DIR` | `./public` | Web 静态前端资源存放路径。目录布局要求：`assets/`、`material-icons/`、`pdfjs/` 在根，页面入口在 `remote/v4/index.html`（详见 [WEB_FRONTEND.md](WEB_FRONTEND.md)）。 |
| `RELAY_AUTH_TOKEN` | *(无)* | 可选。中继接入校验 Token。**开启后两端默认都连不上，需要额外注入 `?token=`**，详见下方专节。 |
| `HEALTH_DETAILS` | *(无)* | **已移除**。`/health` 现在固定只返回 `{"status":"ok"}`，不再支持返回明细。 |
| `LOG_LEVEL` | `info` | 日志级别（`debug` \| `info` \| `warn` \| `error`）。生产环境不输出 payload。 |

---

## ✅ 零鉴权部署（最简单，先看这个）

**如果只是自己用，不需要任何鉴权，配置就三步。**

### 1. 端口只绑本机

```yaml
ports:
  - "127.0.0.1:8765:8765"   # 而不是 "8765:8765"
```

这一步是**安全的关键**：公网无法绕过 nginx 直连中继，但同机的 nginx 仍能转发。

### 2. 清掉 `RELAY_AUTH_TOKEN`

`docker-compose.yml` 里不要留这个变量（注释掉或删掉）。

### 3. nginx 反代

```nginx
location / {
    proxy_pass http://127.0.0.1:8765;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
```

### 桌面端：设置面板填地址，不需要环境变量

打开「移动端远程控制」对话框 → 「远程服务器地址」填：

```
https://zcode-remote.yanhy.top
```

保存后配对自动刷新，二维码变成自建域名。**不需要设任何环境变量。**

### 手机端：扫码即用

页面从 `window.location` 派生 `wss://<当前域名>/ws`，同域部署天然正确。

### 这套配置已实测通过

用真实 Chrome 加载 `/remote/v4`，配一个模拟桌面端跑完整帧序列：

```
1) 桌面端注册成功 device_sid = d_Zhh6...
2) 桌面端 device 鉴权成功 pair_status = waiting
3) 手机端打开二维码 URL（无任何环境变量）
4) relay 会话状态 = {"status":"matched","hasDevice":true,"hasTerminal":true}
   浏览器标题 = "ZCode Dev - Web Remote Control"
   页面文本 = "已配对，正在加载工作区…"
   控制台错误数 = 0
```

剩下的安全性由 TLS + `pass_hash` 挑战应答负责 —— 每次配对都会生成新的随机
`device_sid` 与 `pass_hash`，二维码里不含长期凭据。

> 想再加一层防扫描器的门槛时，再往下看 Basic 认证那节。

---

## 一个 relay 能同时服务多台 ZCode Dev 吗？

**能，各自完全独立。** 会话按 `device_sid` 隔离，互不可见。

### 已验证的行为

同时接入两台桌面端（A、B），各配一个手机端：

```
两台桌面端:
  A sid = d_zZyo-ABrxIVwpgRAeNW-oxaL
  B sid = d_Uiz1vbtjh2_Ya12BkezXXS3D
  sid 互不相同: true

两个手机端配对:
  A pair_status = matched
  B pair_status = matched

数据隔离:
  手机 A 收到: [ 'A' ]
  手机 B 收到: [ 'B' ]

越权测试（用 A 的 passHash 去鉴权 B 的会话）:
  结果 = 拒绝 (AUTH_FAILED)
```

数据帧只在自己那对 device↔terminal 之间转发，跨会话鉴权被 `AUTH_FAILED` 拒绝。

### 但有一个必须避开的坑：同一 `deviceSid` 不能同时用两次

中继对同一 `deviceSid` 只保留**一个** device 连接。第二个连接鉴权成功时，第一个会被
直接关闭（`session.ts` 的 `attachDevice` 逻辑）。

实测两个连接复用同一 `deviceSid`：

```
实例 1 鉴权成功
实例 2 用同一 sid 鉴权 → 成功
实例 1 被踢下线: true
实例 1 自动重连 → 实例 2 被踢
→ 形成无限互踢
```

**这正好命中共享 `~/.zcode` 的双开场景**：`deviceSid` 和 `passHash` 存在
`~/.zcode/v2/setting.json` 与 `credentials.json`，两个安装共用同一份数据目录时，
第二个实例启动会读到**同一个 `deviceSid`**，然后和第一个互踢。

### 实践建议

| 场景 | 是否可行 | 说明 |
| :--- | :--- | :--- |
| 多台**不同机器**共用一个 relay | ✅ 完全可行 | 各自有独立 `~/.zcode`，`deviceSid` 天然不同 |
| 同一台机器双开（共享数据目录） | ⚠️ 会互踢 | 两者读到同一 `deviceSid` |
| 同一台机器双开（隔离数据目录） | ✅ 可行 | 见下方两个环境变量 |

### 同机双开时如何隔离 relay 身份

`deviceSid` 与 `passHash` 分别存在两个文件，**必须同时隔离**：

| 凭据 | 文件 | 由哪个环境变量控制 |
| :--- | :--- | :--- |
| `deviceSid` | `~/.zcode/v2/setting.json` | `ZCODE_DESKTOP_HOME_DIR` |
| `passHash` | `~/.zcode/v2/credentials.json` | `ZCODE_DATA_BASE_DIR` |
| `deviceMid` | `~/.zcode/v2/telemetry-state.json` | `ZCODE_DATA_BASE_DIR` |

所以第二个实例要这样启动：

```powershell
$env:ZCODE_DESKTOP_HOME_DIR = "C:\zcode-instance-b"
$env:ZCODE_DATA_BASE_DIR    = "C:\zcode-instance-b"
```

实测生效结果：

```
ZCODE_DATA_BASE_DIR    → getAppConfigDir() = C:\zcode-instance-b\.zcode\v2
                         存放 telemetry-state.json(deviceMid) 与 credentials.json(passHash)
ZCODE_DESKTOP_HOME_DIR → setting.json = C:\zcode-instance-b\.zcode\v2\setting.json
                         存放 webRemoteControlExternalRelayDevice.deviceSid
```

注意 `ZCODE_STORAGE_DIR` / `ZCODE_SESSION_DB_PATH` **不管**这两个文件，只影响会话数据。
中继侧不需要任何配置改动 —— 它天然按 `deviceSid` 分会话。

---

## ⚠️ `RELAY_AUTH_TOKEN` 与 ZCode 客户端的兼容性

**结论：开启后两端默认都连不上（日志持续 `401` / `Unauthorized upgrade blocked`），
必须让 relay 地址带上 `?token=`。两端都能注入，但方式不同。**

Token 校验发生在 WebSocket upgrade 阶段，只认两个位置：

```
Authorization: Bearer <token>
?token=<token>
```

而 ZCode 两端的默认行为都不带 token：

| 端 | 默认连接地址怎么来的 | 会不会带 token |
| :--- | :--- | :--- |
| 桌面端（`webRemoteControlTransport.ts:263-275`） | `relayWsUrl` + `searchParams.set("mid", ...)` | ❌ 不带 |
| 手机端（`main.tsx` 的 `resolveExternalRelayWsUrl`） | `VITE_` 变量 → `?relay=` 参数 → 从 `window.location` 派生 | ❌ 不带 |

### 桌面端：改 relay 地址（可用）

`ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL` 会被原样使用，直接拼上 token：

```bash
export ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL="wss://your-domain.com/ws?token=eoe"
```

transport 用 `new URL()` 解析后 `searchParams.set("mid", ...)`，不会丢掉已有的 `token`：

```
wss://your-domain.com/ws?token=eoe  →  wss://your-domain.com/ws?token=eoe&mid=<deviceMid>
```

> 注意：**用设置面板里的「自定义服务器地址」不行**。`resolveWebRemoteControlCustomEndpointUrls`
> 会重新拼 `relayWsUrl`（`zcodeEndpoint.ts:463-467`），输入的 query 会被丢掉：
> `https://domain?token=eoe` → `wss://domain/ws`。只有环境变量这条路能带 token。

### 手机端：靠二维码里的 `?relay=` 参数（可用，但绕）

手机端页面的 relay 解析顺序是「`VITE_` 变量 → `?relay=` → 从当前 origin 派生」。
其中 `?relay=` 是可用的注入点，且二维码 URL 会**保留 baseUrl 上已有的 query**：

```bash
# 手机端页面地址带上 relay 参数（token 需要 URL 编码）
export ZCODE_WEB_REMOTE_CONTROL_URL="https://your-domain.com/remote/v4?relay=wss%3A%2F%2Fyour-domain.com%2Fws%3Ftoken%3Deoe"
```

生成的二维码会变成：

```
https://your-domain.com/remote/v4?relay=wss%3A%2F%2F...%3Ftoken%3Deoe&sid=...&hash=...&t=...&mid=...
```

手机扫码后 `resolveExternalRelayWsUrl` 会先命中 `relay` 参数，直接使用带 token 的地址。
实测该参数能正确解码并携带 token 完成握手。

> 这个参数的编码容易出错，`?` 和 `=` 必须编码成 `%3F` / `%3D`，否则会被外层 URL 解析吃掉。

### 方案对比

| 方案 | 桌面端 | 手机端 | 凭据是否会外泄 | 推荐度 |
| :--- | :--- | :--- | :--- | :--- |
| 端口只绑 `127.0.0.1` | 零改动 | 零改动 | 无凭据 | ⭐⭐⭐ 必做 |
| nginx `auth_basic` | 改环境变量（URL 内嵌凭据） | 改环境变量（二维码内嵌凭据） | ⚠️ 二维码 / 地址栏可见 | ⭐⭐ 可选加固 |
| `RELAY_AUTH_TOKEN` | 改环境变量 | 改环境变量（需编码） | ⚠️ 同上 | ⭐ 不推荐 |

**基础防护是「端口只绑本机」，不是任何 Token。** 做完这一步，公网已经无法直连中继，
剩下的鉴权由 TLS + `pass_hash` 挑战应答负责。下面的 Basic 认证只是在此之上的额外一层。

```yaml
ports:
  - "127.0.0.1:8765:8765"   # 而不是 "8765:8765"
```

这样公网无法直连 8765，nginx 在同一台机器上仍能正常转发，两端都不需要改任何配置。

### 可选加固：nginx `auth_basic`

如果还想拦住扫域名的机器人，可以加一层 HTTP Basic。**这条路两端都能走通**（已实测）：

```nginx
auth_basic "zcode";
auth_basic_user_file /www/server/pass/zcode-remote.pass;
```

宝塔面板：「网站 → 设置 → 密码访问」直接生成该文件。

#### 桌面端

把凭据写进 relay 地址即可，`ws` 库会自动转成 `Authorization: Basic` 头：

```bash
export ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL="wss://user:pass@your-domain.com/ws"
```

实测：`new URL()` 后 `searchParams.set("mid", ...)` 不会丢掉 userinfo，
握手时服务端收到 `Authorization: Basic dXNlcjpwYXNz`。

#### 手机端

二维码 baseUrl 内嵌凭据，浏览器会用它在加载页面的同时缓存认证状态：

```bash
export ZCODE_WEB_REMOTE_CONTROL_URL="https://user:pass@your-domain.com/remote/v4"
```

实测三点：

1. `buildWebRemoteControlExternalQrUrl` 会**保留 userinfo**，二维码变成
   `https://user:pass@your-domain.com/remote/v4?sid=...&hash=...`
2. 浏览器用该地址加载页面 → `HTTP 200`，认证状态被缓存
3. **认证后的页面再开同源 WebSocket，握手会自动携带 `Authorization` 头** —— 这是浏览器行为，
   不需要改前端代码

#### ⚠️ 这条路的安全代价

Basic 凭据会出现在这些地方，都是明文：

- **二维码本身** —— 别人拍到你的屏幕就等于拿到密码
- 浏览器地址栏与历史记录
- 桌面端环境变量 / 启动脚本
- 反代 access 日志（如果记录了完整 URI）

所以：**只在你信任「看得到二维码的人」时才用 Basic 认证。** 如果只是想防扫描器，
端口绑本机 + 保持 `RELAY_AUTH_TOKEN` 关闭通常已经够了。

#### 与 `RELAY_AUTH_TOKEN` 的关系

两者可以并存，但没必要。relay 在未配置 `RELAY_AUTH_TOKEN` 时会**忽略** `Authorization` 头
（实测 Basic / Bearer 都能正常握手），所以 nginx 透传的 Basic 头不会干扰 relay。

### `/health` 只返回 `{"status":"ok"}`

该端点随反向代理暴露到公网，因此只回答存活，不提供任何内部状态：

```json
{"status":"ok"}
```

不再包含 `sessions`（在线设备数）、`sessionList`（设备 mid、机器名）、`uptime`（进程存活时长）、
`time`。这些信息对外没有正当用途，反而能被人用来判断服务规模与重启时机。

健康检查只需看 HTTP 状态码与 `status` 字段：

```bash
curl -fsS https://your-domain.com/health && echo OK
```

---

## 方式 1：Docker Compose 一键部署（推荐，带自动 HTTPS）

配合 Caddy 自动申请免费 Let's Encrypt 证书：

### `docker-compose.yml`

```yaml
version: "3.8"

services:
  caddy:
    image: caddy:2-alpine
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - zcode-remote

  zcode-remote:
    # 本仓库没有发布预构建镜像，必须用源码构建（--build）。
    # 若改成 `image: ghcr.io/...` 会拉取失败。
    build: .
    image: zcode-remote:latest
    restart: always
    environment:
      - PORT=8765
      - HOST=0.0.0.0
      - LOG_LEVEL=info
    volumes:
      - ./public:/app/public:ro

volumes:
  caddy_data:
  caddy_config:
```

### `Caddyfile`

```caddyfile
remote.yourdomain.com {
    # WebSocket 中继代理
    handle /ws* {
        reverse_proxy zcode-remote:8765
    }

    # 网页前端与静态资源代理
    handle {
        reverse_proxy zcode-remote:8765
    }
}
```

启动命令：
```bash
docker compose up -d --build
```

> 用 `--build` 才会重新构建镜像。只跑 `docker compose up -d` 时会复用本地已有的 `zcode-remote:latest`，
> 改了源码也看不到效果。

### 只拉代码不拉前端产物？

`public/` 里是约 3900 个已构建的前端文件，如果不希望 `git clone` 拖这么久，可以只取中继代码：

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/yanhy2000/zcode-WebRemote.git
cd zcode-WebRemote
git sparse-checkout set --no-cone '/*' '!/public'
```

中继能正常启动并处理 `/ws`，但手机端页面会 404。之后要补前端时执行
`git sparse-checkout disable` 重新检出；或者直接用
[WEB_FRONTEND.md](WEB_FRONTEND.md) 的流程本地构建一份 `public/` 挂载进去。

### 常见构建失败

`ERR_PNPM_IGNORED_BUILDS: Ignored build scripts: esbuild@…`

pnpm 10 起默认不执行依赖的安装脚本，而 `vitest` / `tsx` 依赖 `esbuild`，esbuild 必须跑自己的安装脚本才能拿到可执行文件。
本项目已在 `package.json` 中显式放行：

```json
"pnpm": { "onlyBuiltDependencies": ["esbuild"] }
```

同时 `packageManager` 固定了 pnpm 主版本，Dockerfile 用 `corepack` 读取该字段，不会漂移到更新的 pnpm 大版本。
如果仍然报这个错，说明本地/服务器上的镜像缓存是旧 Dockerfile 构建的，执行 `docker compose build --no-cache` 重建。

---

## 方式 2：纯 Node.js / PM2 本地运行

在已有 Node.js (>= 20) 的服务器上：

```bash
git clone https://github.com/yourname/zcode-remote.git
cd zcode-remote
corepack enable   # 依据 package.json 的 packageManager 字段启用对应 pnpm 版本
pnpm install
pnpm build
pnpm start
```

使用 PM2 守护：
```bash
pm2 start dist/index.js --name "zcode-remote"
```

---

## 方式 3：免费内网穿透（无公网 IP 电脑自建）

如果没有云服务器，可以在电脑上启动本地 Relay，配合 Cloudflare Tunnel 免费穿透：

1. 本地启动 `zcode-remote`：
   ```bash
   HOST=127.0.0.1 pnpm start # 只给本机的 cloudflared 访问
   ```
2. 启动 Cloudflare Tunnel：
   ```bash
   cloudflared tunnel --url http://127.0.0.1:8765
   ```
3. 控制台将生成一个临时或绑定的域名（如 `https://random-name.trycloudflare.com`），直接将该 URL 配置至桌面端即可使用，无需路由器端口映射。

---

## 反向代理（Nginx / 宝塔面板）

`/ws` 是 WebSocket 长连接，反向代理必须同时满足三件事，缺一个就连不上：

```nginx
location / {
    proxy_pass http://127.0.0.1:8765;
    proxy_http_version 1.1;                          # 必须 1.1，否则无法 upgrade
    proxy_set_header Upgrade $http_upgrade;          # 透传 Upgrade
    proxy_set_header Connection $connection_upgrade; # 需要 nginx.conf 里有 map
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_buffering off;        # 关缓冲，否则流式输出会被攒住
    proxy_read_timeout 3600s;   # 长连接别用默认 60s 掐断
}
```

宝塔面板的「反向代理」功能会自动加 `#WEBSOCKET-SUPPORT` 段和 `map $http_upgrade $connection_upgrade`，通常无需手改。

### 502 Bad Gateway 排查顺序

日志里出现 `GET /ws?... 502` 说明**请求没到容器**，按下面顺序查，不要先怀疑证书或防火墙：

1. **先看容器启动日志的监听地址**
   ```
   [relay] Server listening on http://127.0.0.1:8765   ← 有问题
   [relay] Server listening on http://0.0.0.0:8765     ← 正常
   ```
   显示 `127.0.0.1` 就表示容器只在自身回环上监听。Docker 的 `-p 8765:8765`
   转发到容器网卡（eth0），连不上容器 loopback，nginx 必然 502。
   修法：`docker-compose.yml` 里设 `HOST=0.0.0.0`（默认值就是它，通常是被改错了）。

2. **绕过 nginx 直连容器**
   ```bash
   curl -i http://127.0.0.1:8765/health
   ```
   宿主机上返回 `{"status":"ok",...}` 说明容器和端口映射都正常，问题在 nginx 侧；
   返回 `Connection refused` 说明容器没真正对外监听，回到第 1 步。

3. **确认容器内进程活着**
   ```bash
   docker compose ps
   docker compose logs --tail=50 zcode-remote
   ```

4. 以上都对仍然 502，检查 nginx 的 upstream 地址是否写成了 `localhost`
   （IPv6 `::1` 优先时会连不上只监听 IPv4 的容器），改成 `127.0.0.1`。

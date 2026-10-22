# ZCode Remote 部署与自建指南

本文档介绍如何在各种环境下部署 `zcode-remote` 服务端。

---

## 环境变量配置

| 变量名 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `PORT` | `8765` | 服务监听端口。 |
| `HOST` | `0.0.0.0` | 服务监听 IP。**几乎总是保持 `0.0.0.0`**：Docker 端口映射和反向代理都要经容器网卡进来，设成 `127.0.0.1` 会导致宿主机 `curl` 和 nginx 全部 502。只有在本机直接跑、且确认只给本机进程访问时才改成 `127.0.0.1`。 |
| `STATIC_DIR` | `./public` | Web 静态前端资源存放路径。目录布局要求：`assets/`、`material-icons/`、`pdfjs/` 在根，页面入口在 `remote/v4/index.html`（详见 [WEB_FRONTEND.md](WEB_FRONTEND.md)）。 |
| `RELAY_AUTH_TOKEN` | *(无)* | 可选。中继接入校验 Token；配置后握手时必须在 Header 或 Query 中携带。 |
| `LOG_LEVEL` | `info` | 日志级别（`debug` \| `info` \| `warn` \| `error`）。生产环境不输出 payload。 |

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

# ZCode Remote 部署与自建指南

本文档介绍如何在各种环境下部署 `zcode-remote` 服务端。

---

## 环境变量配置

| 变量名 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `PORT` | `8765` | 服务监听端口。 |
| `HOST` | `0.0.0.0` | 服务监听 IP（容器环境设为 `0.0.0.0`，本地代理可设为 `127.0.0.1`）。 |
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
   pnpm start # 监听 127.0.0.1:8765
   ```
2. 启动 Cloudflare Tunnel：
   ```bash
   cloudflared tunnel --url http://127.0.0.1:8765
   ```
3. 控制台将生成一个临时或绑定的域名（如 `https://random-name.trycloudflare.com`），直接将该 URL 配置至桌面端即可使用，无需路由器端口映射。

# ZCode Remote 部署与自建指南

本文档介绍如何在各种环境下部署 `zcode-remote` 服务端。

---

## 环境变量配置

| 变量名 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `PORT` | `8765` | 服务监听端口。 |
| `HOST` | `0.0.0.0` | 服务监听 IP（容器环境设为 `0.0.0.0`，本地代理可设为 `127.0.0.1`）。 |
| `STATIC_DIR` | `./public` | Web 静态前端资源存放路径。 |
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
    image: ghcr.io/yourname/zcode-remote:latest
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
docker compose up -d
```

---

## 方式 2：纯 Node.js / PM2 本地运行

在已有 Node.js (>= 20) 的服务器上：

```bash
git clone https://github.com/yourname/zcode-remote.git
cd zcode-remote
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

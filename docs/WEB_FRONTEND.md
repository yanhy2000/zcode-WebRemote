# Web 前端（`/remote/v4`）的来源与更新

本仓库的 `public/` 不是手写页面，而是 **ZCode 私有 fork（`yanhy2000/ZCode`）构建出来的 Web 客户端产物**。
远控页面与协议的关系可以概括成一句话：

> **桌面端用 V1 协议（`pass_hash` 挑战应答 + `/ws` 中继），手机端页面用 3.16.1 的共享 UI 组件。**

这样既拿到了 ZCode 3.16.1 的手机端界面，又不需要账号登录，也不需要 V2 的 `/api/v1/remote/*` 设备/令牌接口。

---

## 1. 产物里有什么

```
public/
├── assets/                       # 主包、按需 chunk、worker、样式（构建产物的 assets 目录）
├── material-icons/               # 图标字体
├── pdfjs/                        # PDF 预览用的 pdf.js 资源
├── remote/v4/index.html          # 远控页面入口（服务器 SPA 回退到它）
├── favicon.ico
└── THIRD-PARTY-NOTICES.md
```

- 页面入口固定是 `/remote/v4`，`index.html` 通过 `/assets/*` 绝对路径加载资源，
  所以 `assets/` 必须放在 `STATIC_DIR` 根目录（**不要**放到 `remote/v4/assets/`，
  否则 `@pierre/diffs` 的 worker 会 404，页面白屏）。
- `/` 根路径没有 `index.html`，会落到服务端内置的欢迎页，这是预期行为。

## 2. 构建方式（在 ZCode fork 仓库里执行）

```bash
cd packages/web
VITE_WEB_REMOTE_CONTROL_ROUTE_PATH=/remote/v4 \
  pnpm dlx node@24.14.0 ../../node_modules/vite/bin/vite.js build --mode production
# 产物在 packages/web/dist
```

要点：

1. **Node 24**（`mise.toml` 要求 24.14.0）。Node 22 会在加载 `vite.config.ts` 时报
   `ERR_UNKNOWN_FILE_EXTENSION: .ts`。
2. **必须设置 `VITE_WEB_REMOTE_CONTROL_ROUTE_PATH=/remote/v4`**。缺这个变量时，
   页面用 `BASE_URL=/` 推导路由，`/remote/v4` 不匹配远控路由，结果 `#root` 为空（白屏）。
3. **不要**加 `--base=/remote/v4/`。加了之后 `index.html` 的资源路径变成
   `/remote/v4/assets/...`，而 worker 仍按绝对路径 `/assets/...` 请求，就必须在
   `STATIC_DIR` 根目录和 `remote/v4/` 下各放一份 `assets`（约 2×48 MB）。用默认 base `/` 最省事。
4. 构建可在 30~50 秒内完成；去 sourcemap 后产物约 **48 MB / 3900 个文件**。

## 3. 更新流程

```powershell
# 1) 在 fork 仓库构建（见上）
# 2) 覆盖本仓库 public/（保留上一版用于回滚）
Move-Item public public-3.15.1 -Force
New-Item -ItemType Directory public | Out-Null
Copy-Item <fork>/packages/web/dist/assets public/assets -Recurse
New-Item -ItemType Directory public/remote/v4 | Out-Null
Copy-Item <fork>/packages/web/dist/index.html public/remote/v4/index.html
Copy-Item <fork>/packages/web/dist/favicon.ico public/
Copy-Item <fork>/packages/web/dist/THIRD-PARTY-NOTICES.md public/
Copy-Item <fork>/packages/web/dist/material-icons public/ -Recurse
Copy-Item <fork>/packages/web/dist/pdfjs public/ -Recurse
Get-ChildItem public/assets -Recurse -Filter *.map | Remove-Item
```

回滚：删掉新 `public/`，把 `public-3.15.1/` 改回 `public/` 即可（该版本同样按
`remote/v4/index.html` + 根 `assets/` 布局）。

## 4. 已知问题

- **`/api/v1/client/configs` 请求失败**：页面启动时会请求
  `https://zcode.z.ai/api/v1/client/configs?app_version=...`，自建域名下被 CORS 拒绝，
  控制台有一条红色报错。**不影响远控功能**（客户端配置按空处理）。
  彻底解决需要在 fork 里收敛 `clientConfigService`（batch E 待办），或在本服务里做同源兜底。
- **不要期待 V2 专有界面**：设备列表页、`mobile-task-view-request/update` 同步通道属于上游
  3.16.1 的 V2 前端模块，我们用的是 V1 入口，这两项没有。其余共享 UI（`packages/ui`）是 3.16.1 版本。
- 上游 3.16.1 原生 `packages/web` **不能直接用于自建**：它要求账号 JWT
  （入口处 `!getZCodeJwtToken()` 直接跳登录页），relay 建连用 `?token=<JWT>`，
  且不再实现 `auth_challenge`，与本项目的 `pass_hash` 挑战应答不兼容。

## 5. 产物溯源

| 项目 | 值 |
| :--- | :--- |
| 来源仓库 | `github.com/yanhy2000/ZCode`（ZCode 私有 fork） |
| 官方基线 | 3.16.1（fork 版本 `1.0.0+3.16.1`） |
| 远控入口 | V1（`packages/web/src/webRemoteControlTransport.ts` 等 3.15.1 文件保持逐字节不变） |
| 共享 UI | 3.16.1 |
| 构建命令 | 见 §2 |

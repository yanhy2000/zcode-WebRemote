# Web 前端（`/remote/v4`）的来源与更新

本仓库的 `public/` 不是手写页面，而是 **ZCode 私有 fork（`yanhy2000/ZCode`）构建出来的 Web 客户端产物**。
远控页面与协议的关系可以概括成一句话：

> **桌面端用 V1 协议（`pass_hash` 挑战应答 + `/ws` 中继），手机端页面用 ZCode 的 Web 客户端构建产物。**

**当前只维护 3.15.1 一条线**：`public/` 就是 3.15.1 构建，对应 ZCode fork 的 `dev` 分支
（版本 `1.0.0+3.15.1`）。3.16.1 的前端产物与本仓库的 3.16.1 分支已删除，不再并行维护。

为什么选 3.15.1：它是实际长期使用过的稳定线，界面与协议自洽；3.16.1 的界面更"新"（任务列表侧栏形态），
但上游在 3.16.1 有一次手机壳回归（侧栏仍渲染自动化/插件市场死入口），且 3.16.1 原生 web 需要账号登录
+ `?token=` 鉴权，与 V1 自建不兼容。以后要动，就在 3.15.1 基础上改。


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

回滚：删掉新 `public/`，把备份目录改回 `public/` 即可（两套都按
`remote/v4/index.html` + 根 `assets/` 布局）。

当前 `public/` 是唯一一套产物：

| 目录 | 内容 | 对应 fork 分支 |
| :--- | :--- | :--- |
| `public/` | 3.15.1 构建（`index-BOQkLy26.js`） | `dev @ 4273a987`（`1.0.0+3.15.1`） |


## 4. 已知问题

- 3.15.1 构建启动时**不会**请求 `https://zcode.z.ai/api/v1/client/configs`，自建环境下控制台干净。
- 协议是 V1（`pass_hash` 挑战应答 + `/ws`），页面里没有账号登录、没有 V2 设备/令牌接口调用；
  如果以后换成需要账号鉴权的上游前端，relay 侧要同步实现对应接口，不能直接替换静态文件。
- **Web 端与桌面端是两个独立产物**：桌面安装包自带 UI，Web 端用的是本仓库 `public/` 里的静态构建。
  改完 `packages/ui` 后如果只打包桌面版，Web 端不会更新，会出现「桌面有、Web 没有」的差异。
  任何 UI 改动都要按 §3 重建并部署一次。

## 5. 产物溯源

| 项目 | 值 |
| :--- | :--- |
| 来源仓库 | `github.com/yanhy2000/ZCode`（ZCode 私有 fork） |
| 官方基线 | **3.15.1**（fork 版本 `1.0.0+3.15.1`，`dev @ 4273a987`） |
| 远控入口 | V1（`pass_hash` 挑战应答 + `/ws`） |
| 构建命令 | 见 §2 |

`public/` 不是纯上游 3.15.1：fork 的 `dev` 上带多处本地改动，随产物一起生效——
远控 web 端插件市场打不开（主视图回落把 `plugin-store` 打回 `chat`，且手机壳没有商店页）、
常规设置新增“标题生成模型”、帮助菜单与错误面板的问题上报改跳项目 issue。
重新构建时如果切回上游 tag，这个修复会丢失，插件市场会重新变成死按钮。


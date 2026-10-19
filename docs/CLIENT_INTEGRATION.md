# ZCode 客户端对接与配置指南

本文档记录 `zcode-remote` 与 ZCode 桌面端、网页端对接的详细规范，方便未来主任务线程结束时进行无缝联调。

---

## 1. 当前开箱即用的对接方式（无需改动 ZCode 源码）

ZCode 桌面端已经原生内置了针对外部 Relay 和自定义前端的环境变量覆盖入口：

### 1.1 桌面端环境变量覆盖

启动桌面端前设置以下两个环境变量：

```bash
# Windows PowerShell
$env:ZCODE_WEB_REMOTE_CONTROL_URL = "https://your-domain.com/remote/v4"
$env:ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL = "wss://your-domain.com/ws"

# Linux / macOS
export ZCODE_WEB_REMOTE_CONTROL_URL="https://your-domain.com/remote/v4"
export ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL="wss://your-domain.com/ws"
```

* **生效点**：
  * `packages/desktop/src/main/index.ts:711-729`：覆盖生成二维码的 Base URL 以及桌面端连接 Relay 的 WSS 目标。
  * 桌面端开启远控时，二维码会直接渲染为：
    `https://your-domain.com/remote/v4?sid=...&hash=...`

---

## 2. 网页端静态构建与对接

网页端是基于 ZCode 仓库中的 `packages/web` 构建的纯静态应用。

### 2.1 构建参数

在 `packages/web` 目录下执行构建时，注入以下环境变量：

```bash
# 构建时注入自建 Relay 地址（若在同一域名下，也可以省略让浏览器从当前 origin 自动派生）
VITE_ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL="wss://your-domain.com/ws"
VITE_ZCODE_BASE_URL="https://your-domain.com"
```

打包产物为标准的 SPA 静态文件（包含 `index.html` 和 `assets/`），直接放置在 `zcode-remote` 的静态资源目录中（如 `public/remote/v4/`），由服务端静态托管。

---

## 3. 未来客户端 UI 演进设计（主任务线程结束后落地）

为了让不懂环境变量的普通开源用户也能“一键切换自建服务器”，计划在主线程空闲后，在 ZCode 客户端设置面板中补充图形化选项：

### 3.1 设置结构体扩展 (`packages/shared/src/settings.ts`)

```typescript
export interface AppSettings {
  // ... 已有设置 ...
  /** 自定义 Web 远控服务器（留空使用官方节点，或填入用户自建地址） */
  webRemoteControlCustomServer?: {
    enabled: boolean;
    serverUrl: string; // 例如 "https://remote.myuser.com"
  };
}
```

### 3.2 自动 URL 派生逻辑 (`packages/shared/src/zcodeEndpoint.ts`)

当 `customServer.enabled === true` 时：
* `remoteUrl` 自动派生为：`${serverUrl}/remote/v4`
* `relayWsUrl` 自动派生为：`ws(s)://${serverHost}/ws`

用户只需要在界面上输入一个地址（如 `https://remote.myuser.com`），点击保存即可，彻底免去配置环境变量的繁琐流程。

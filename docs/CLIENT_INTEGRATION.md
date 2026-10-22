# ZCode 客户端对接与配置指南

本文档记录 `zcode-remote` 与 ZCode 桌面端、网页端的对接方式。

---

## 0. 零鉴权部署：不需要配置任何东西

如果中继只绑本机、不启用 `RELAY_AUTH_TOKEN`、不加 nginx Basic 认证，那么**桌面端不需要设置任何环境变量**，
用图形界面填一个地址即可（见第 3 节）。手机端扫码就能用。

已实测确认（真实 Chrome 加载 `/remote/v4` + 模拟桌面端完整帧序列）：

```
1) 桌面端注册成功 device_sid = d_Zhh6...
2) 桌面端 device 鉴权成功 pair_status = waiting
3) 手机端打开二维码 URL（无任何环境变量）
4) relay 会话状态 = {"status":"matched","hasDevice":true,"hasTerminal":true}
   浏览器页面标题 = "ZCode Dev - Web Remote Control"
   页面文本 = "已配对，正在加载工作区…"
   控制台错误数 = 0
```

关键点：

- 手机端页面的 relay 地址从 `window.location` 派生（`wss://<当前域名>/ws`），同域部署时**天然正确**
- 二维码里的 `sid` / `hash` / `mid` 由桌面端自动拼装，扫码即完成配对
- 桌面端只在需要指向不同域名时才需要环境变量；同域名或设置面板可填的地址，两者都不用

---

## 1. 环境变量覆盖（只在需要时使用）

ZCode 桌面端内置了针对外部 Relay 和自定义前端的环境变量覆盖入口。
**只有在下面两种情况才需要**：a) 想用 `?token=` / `user:pass@` 携带鉴权凭据；
b) 不想用设置面板。普通零鉴权部署可以跳过本节。

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
  * `packages/desktop/src/main/index.ts:686-751`：覆盖生成二维码的 Base URL 以及桌面端连接 Relay 的 WSS 目标。
  * 桌面端开启远控时，二维码会直接渲染为：
    `https://your-domain.com/remote/v4?sid=...&hash=...`
* **环境变量优先级高于设置面板**：两者都配时以环境变量为准。

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

## 3. 图形化配置（已落地，推荐普通用户使用）

不用环境变量也能切换自建服务器：桌面端「移动端远程控制」对话框里有「远程服务器设置」。

### 3.1 使用方式

1. 打开桌面端的移动远控对话框
2. 在「远程服务器地址」里填入自建服务器根地址，例如 `https://zcode-remote.yanhy.top`
3. 点保存 —— 配对会自动刷新，二维码随之变成自建域名

字段存在 `AppSettings.webRemoteControlCustomServerUrl`（字符串，留空即回退官方节点）。
点「恢复默认」清空。

### 3.2 派生规则

`resolveWebRemoteControlCustomEndpointUrls`（`packages/shared/src/zcodeEndpoint.ts`）负责解析：

| 输入 | 派生出的 `relayWsUrl` | 派生出的 `remoteUrl` |
| :--- | :--- | :--- |
| `https://example.com` | `wss://example.com/ws` | `https://example.com/remote/v4` |
| `http://192.168.1.100:8765` | `ws://192.168.1.100:8765/ws` | `http://192.168.1.100:8765/remote/v4` |
| `https://example.com/remote/v4` | `wss://example.com/ws` | 保留原路径 |

无协议前缀时默认补 `http://`；`https`/`wss` 会派生 `wss`，其余派生 `ws`。
`/remote/v3` 还是 `/remote/v4` 取决于调用方传入的 `appVersion`（≥ 3.4.0 走 v4）。

### 3.3 这个入口**不能**传鉴权凭据

该函数会重建 `relayWsUrl`，输入的 query 与 userinfo 都会被丢掉：

```
https://domain?token=eoe            →  wss://domain/ws
https://domain/ws?token=eoe         →  wss://domain/ws
https://user:pass@domain            →  wss://domain/ws
```

所以启用 `RELAY_AUTH_TOKEN` 或 nginx Basic 认证时，只能走环境变量
（见 [DEPLOYMENT.md](DEPLOYMENT.md)）。**零鉴权部署用这个图形入口是最省事的路径。**

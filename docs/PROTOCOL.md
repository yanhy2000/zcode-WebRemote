# ZCode Remote 协议规范与帧定义

本文档详细定义 `zcode-remote` 中继服务的通信协议规范、数据帧结构、HMAC 加密算法和单元测试证明向量。

---

## 1. URL 格式与二维码参数

桌面端开启远控后生成的二维码 URL 格式如下：

```text
{baseUrl}/remote/v4?sid={deviceSid}&hash={passHash}&t={timestamp}&mid={deviceMid}&name={deviceName}&app_version={appVersion}&theme={theme}
```

### 参数字典

| 参数名 | 类型 | 必选 | 说明 |
| :--- | :--- | :---: | :--- |
| `sid` | string | 是 | 设备的会话标识（`deviceSid`），格式为 `d_` 开头的 base64url 随机串。 |
| `hash` | string | 是 | 二维码鉴权密钥哈希（`passHash`），URL-encode 后的 base64 字符串。 |
| `t` | number | 是 | 生成时间戳（毫秒），如 `1792379994235`。 |
| `mid` | string | 否 | 桌面设备的机器 ID（UUID 格式）。 |
| `name` | string | 否 | 桌面主机名称（如 `DESKTOP-E8AVAKO`）。 |
| `app_version`| string | 否 | 客户端版本号（如 `3.15.1`）。 |
| `theme` | string | 否 | 主题偏好种子（`light` \| `dark` \| `zai-light` \| `zai-dark` \| `system`）。 |

---

## 2. 身份认证与挑战应答算法 (HMAC-SHA256)

### 2.1 算法流程

1. **密钥派生**：
   - 客户端首次生成 24 字节随机密码：`password = randomBytes(24).toString("base64url")`
   - 计算密码哈希：`passHash = sha256(password).toString("base64")`
2. **挑战下发**：
   - Relay 收到 `auth_init` 后，生成一次性密码学安全随机串 `nonce`（推荐 16~32 字符），通过 `auth_challenge` 下发。
3. **证明计算（双方）**：
   - 待签名明文消息：`${nonce}|${role}|${deviceSid}`
   - 证明摘要：`proof = HMAC-SHA256(key = passHash, msg = message).toString("base64url")`
   - *注意：编码格式必须严格使用 `base64url`（将 `+` 替换为 `-`，`/` 替换为 `_`，去除末尾 `=` 填充）。*

### 2.2 证明测试向量（Proof Vectors）

Relay 单元测试必须能够通过以下基准测试向量：

```json
[
  {
    "passHash": "dGVzdF9oYXNo",
    "nonce": "nonce-1",
    "role": "device",
    "deviceSid": "device-1",
    "expectedProof": "XK0m7u-26VS88uk7ISAX5Z_9pjzq8jqyP77N-HkCsPE"
  },
  {
    "passHash": "dGVzdF9oYXNo",
    "nonce": "nonce-1",
    "role": "terminal",
    "deviceSid": "device-1",
    "expectedProof": "YkqkJy-p-iZK1g1AcoGd0Q83REOggX1EygWkcxW4oLU"
  }
]
```

---

## 3. WebSocket 消息帧规格

所有帧均为 JSON 格式文本帧。

### 3.1 设备首次注册 (Device Registration)

#### `device_register_init` (Client -> Relay)
桌面端初次上线无 `deviceSid` 时发送：
```json
{
  "type": "device_register_init",
  "device_mid": "d3b874cd-f946-4352-bc3c-f7ea787be847",
  "pass_hash": "y0LZoCA0xPbs568Yy97NX4msOGDSq2gjdy4/QinSirA=",
  "meta": {
    "platform": "win32",
    "version": "3.15.1",
    "name": "DESKTOP-E8AVAKO"
  },
  "client_ts": 1792379994235
}
```

#### `device_register_ack` (Relay -> Client)
Relay 分配 `device_sid` 并应答：
```json
{
  "type": "device_register_ack",
  "device_sid": "d_Xx8aQk1e2ro5NFXMopVVX7",
  "server_ts": 1792379994240
}
```

---

### 3.2 挑战应答握手 (Authentication)

#### `auth_init` (Client -> Relay)
Device 或 Terminal 发起身份认证：
```json
{
  "type": "auth_init",
  "role": "terminal", // "device" | "terminal"
  "device_sid": "d_Xx8aQk1e2ro5NFXMopVVX7",
  "meta": {
    "platform": "web",
    "version": "3.15.1",
    "name": "mobile-browser"
  },
  "client_ts": 1792379995100
}
```

#### `auth_challenge` (Relay -> Client)
Relay 下发一次性随机 nonce：
```json
{
  "type": "auth_challenge",
  "nonce": "n_9b2e8c1a7d4f3e6a",
  "server_ts": 1792379995105
}
```

#### `auth_response` (Client -> Relay)
客户端回传签名 Proof：
```json
{
  "type": "auth_response",
  "device_sid": "d_Xx8aQk1e2ro5NFXMopVVX7",
  "proof": "YkqkJy-p-iZK1g1AcoGd0Q83REOggX1EygWkcxW4oLU",
  "client_ts": 1792379995110
}
```

#### `auth_ack` (Relay -> Client)
Relay 验证成功，返回配对状态：
```json
{
  "type": "auth_ack",
  "device_sid": "d_Xx8aQk1e2ro5NFXMopVVX7",
  "terminal_sid": "t_9a8b7c6d5e4f3a2b",
  "pair_status": "matched", // "waiting" | "matched"
  "server_ts": 1792379995120
}
```

---

### 3.3 配对状态查询与心跳保活 (Pair Status / Heartbeat)

客户端每隔 15~30 秒发送保活查询，防止连接被网络网关切断：

#### `pair_status_query` (Client -> Relay)
```json
{
  "type": "pair_status_query",
  "device_sid": "d_Xx8aQk1e2ro5NFXMopVVX7",
  "client_ts": 1792380025000
}
```

#### `pair_status_ack` (Relay -> Client)
```json
{
  "type": "pair_status_ack",
  "terminal_sid": "t_9a8b7c6d5e4f3a2b",
  "pair_status": "matched",
  "server_ts": 1792380025005
}
```

---

### 3.4 业务数据透传 (Data Forwarding)

当双方状态处于 `matched` 时，Relay 直接原样对向转发：

#### `data` (Bidirectional)
```json
{
  "type": "data",
  "payload": {
    "zcode_type": "workspace-bridge-open",
    "requestId": "bridge_123456",
    "workspaceKey": "d:\\Project\\MyRepo"
  },
  "client_ts": 1792380030000
}
```

---

### 3.5 错误与断连帧 (Error & Close)

#### `error` (Relay -> Client)
```json
{
  "type": "error",
  "code": "KICKED",
  "message": "A newer terminal connection has taken over this remote session."
}
```

#### 错误码定义字典

| 错误码 | 说明 | 客户端行为 |
| :--- | :--- | :--- |
| `AUTH_FAILED` | HMAC 签名校验失败或凭据无效 | 终止连接并提示重新生成二维码。 |
| `DEVICE_OFFLINE` | Terminal 请求转发时 Device 未在线 | 提示桌面离线或进入重试窗口。 |
| `KICKED` | 另一台设备扫码介入，当前连接被踢出 | 渲染 session-conflict 终态页。 |
| `WRONG_PARAM` | 请求参数缺失或非法 | 关闭连接。 |
| `INTERNAL` | 内部路由转发暂时无对端可用 | 客户端进入轻量级指数退避重试。 |

#### 标准 WebSocket 关闭码 (Close Codes)
* `4004`：SessionNotFound（找不到该 `deviceSid`）
* `4009`：SessionConflict（多终端冲突踢出）

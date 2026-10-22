/**
 * `RELAY_AUTH_TOKEN` 的启动期提示文案。
 *
 * Token 校验发生在 HTTP upgrade 阶段，只认 `Authorization: Bearer <token>`
 * 或 `?token=<token>`。ZCode 两端默认都不携带：
 *   - 桌面端 transport 只发 `X-Device-ID` 头和 `?mid=` 参数
 *   - 手机端页面从 window.location 派生 `wss://<host>/ws`
 * 所以开启后两端都会卡在 401。但两端都有可用的注入点（见文档），
 * 启动时把路径说清楚，避免用户在 401 日志里盲猜。
 */
export function buildIngressTokenStartupWarning(): string {
  return [
    "[relay] 注意：RELAY_AUTH_TOKEN 已启用。ZCode 两端默认都不携带 token，需要按下面方式注入：",
    "[relay]   桌面端：把 ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL 设为 wss://<域名>/ws?token=<token>",
    "[relay]   手机端：把 ZCODE_WEB_REMOTE_CONTROL_URL 设为 https://<域名>/remote/v4?relay=<编码后的 wss 地址>",
    "[relay] 若只是不想让公网直连 8765，更省事的是把端口映射改成 127.0.0.1:8765:8765，",
    "[relay] 只让反向代理转发进来；这样两端都不用改配置。",
  ].join("\n");
}

/**
 * Token 校验失败时的日志文案。只说明检查了哪两个位置，绝不回显 token 本身。
 */
export function buildUnauthorizedUpgradeLog(): string {
  return (
    "[relay] Unauthorized upgrade blocked: 未携带有效 token。" +
    "（需要 Authorization: Bearer <token> 或 ?token=<token>）"
  );
}

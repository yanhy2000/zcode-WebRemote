/**
 * `/health` 响应体。
 *
 * 只返回 `{"status":"ok"}`。这个端点随反向代理暴露到公网，
 * 任何额外字段都是在告诉外人服务端的内部状态：
 *   - `sessions` / `sessionList` → 有多少设备在线、设备 mid、机器名
 *   - `uptime` → 进程存活时长，可用于判断重启时机
 * 存活探测只需要「服务是否响应」，其余信息一律不提供。
 */
export interface HealthPayload {
  status: "ok";
}

export function buildHealthPayload(): HealthPayload {
  return { status: "ok" };
}

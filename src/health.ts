/**
 * `/health` 响应体构造。
 *
 * 默认**不**返回 `sessionList`：其中含 `device_mid` 与设备名（hostname），
 * 属于设备身份信息。该端点几乎总是随反向代理整个暴露到公网，
 * 无条件返回等于告诉任何人「谁正在跑远控、机器叫什么」。
 * 需要排障时显式设置 `HEALTH_DETAILS=1` 打开。
 */
export interface HealthSnapshot {
  sessionCount: number;
  sessionList: unknown[];
  uptimeSeconds: number;
  nowIso: string;
}

export interface HealthPayloadOptions {
  includeDetails: boolean;
}

export function buildHealthPayload(
  snapshot: HealthSnapshot,
  options: HealthPayloadOptions,
): Record<string, unknown> {
  const base = {
    status: "ok",
    sessions: snapshot.sessionCount,
    uptime: snapshot.uptimeSeconds,
    time: snapshot.nowIso,
  };
  if (!options.includeDetails) {
    return base;
  }
  return { ...base, sessionList: snapshot.sessionList };
}

/**
 * `HEALTH_DETAILS` 是否开启明细。仅接受明确的真值，其余一律视为关闭，
 * 避免 `HEALTH_DETAILS=0` / `false` 这类写法被误判为开启。
 */
export function resolveHealthDetailsFlag(raw: string | undefined): boolean {
  const normalized = raw?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

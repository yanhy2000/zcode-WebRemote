import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { WebRemoteControlRelayRole } from "./types.js";

/**
 * 计算 HMAC-SHA256 身份证明
 */
export function calculateProof(
  passHash: string,
  nonce: string,
  role: WebRemoteControlRelayRole,
  deviceSid: string,
): string {
  return createHmac("sha256", passHash)
    .update(`${nonce}|${role}|${deviceSid}`)
    .digest("base64url");
}

/**
 * 常数时间比较证明串，防御时序攻击
 */
export function verifyProof(
  expectedProof: string,
  providedProof: string,
): boolean {
  if (typeof expectedProof !== "string" || typeof providedProof !== "string") {
    return false;
  }
  const bufExpected = Buffer.from(expectedProof, "utf8");
  const bufProvided = Buffer.from(providedProof, "utf8");
  if (bufExpected.length !== bufProvided.length) {
    return false;
  }
  return timingSafeEqual(bufExpected, bufProvided);
}

/**
 * 生成一次性随机挑战 Nonce
 */
export function generateNonce(): string {
  return "n_" + randomBytes(16).toString("base64url");
}

/**
 * 分配新的设备会话 ID
 */
export function generateDeviceSid(): string {
  return "d_" + randomBytes(18).toString("base64url");
}

/**
 * 分配终端会话 ID
 */
export function generateTerminalSid(): string {
  return "t_" + randomBytes(18).toString("base64url");
}

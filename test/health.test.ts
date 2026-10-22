import { describe, expect, it } from "vitest";
import { buildHealthPayload, resolveHealthDetailsFlag } from "../src/health.js";

const snapshot = {
  sessionCount: 2,
  sessionList: [{ deviceSid: "d_1", mid: "private-mid", name: "DESKTOP-ABC" }],
  uptimeSeconds: 12.5,
  nowIso: "2026-10-22T00:00:00.000Z",
};

describe("buildHealthPayload", () => {
  it("默认不泄露设备身份信息", () => {
    const payload = buildHealthPayload(snapshot, { includeDetails: false });
    expect(payload).toEqual({
      status: "ok",
      sessions: 2,
      uptime: 12.5,
      time: "2026-10-22T00:00:00.000Z",
    });
    expect(JSON.stringify(payload)).not.toContain("private-mid");
    expect(JSON.stringify(payload)).not.toContain("DESKTOP-ABC");
  });

  it("显式开启后返回 sessionList 供排障", () => {
    const payload = buildHealthPayload(snapshot, { includeDetails: true });
    expect(payload.sessions).toBe(2);
    expect(payload.sessionList).toEqual(snapshot.sessionList);
  });

  it("sessionList 字段名只在开启时出现", () => {
    expect("sessionList" in buildHealthPayload(snapshot, { includeDetails: false })).toBe(false);
    expect("sessionList" in buildHealthPayload(snapshot, { includeDetails: true })).toBe(true);
  });
});

describe("resolveHealthDetailsFlag", () => {
  it("识别明确的真值", () => {
    expect(resolveHealthDetailsFlag("1")).toBe(true);
    expect(resolveHealthDetailsFlag("true")).toBe(true);
    expect(resolveHealthDetailsFlag(" TRUE ")).toBe(true);
    expect(resolveHealthDetailsFlag("yes")).toBe(true);
  });

  it("未设置或假值一律关闭", () => {
    expect(resolveHealthDetailsFlag(undefined)).toBe(false);
    expect(resolveHealthDetailsFlag("")).toBe(false);
    expect(resolveHealthDetailsFlag("0")).toBe(false);
    expect(resolveHealthDetailsFlag("false")).toBe(false);
    expect(resolveHealthDetailsFlag("no")).toBe(false);
    expect(resolveHealthDetailsFlag("anything")).toBe(false);
  });
});

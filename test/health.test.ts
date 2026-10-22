import { describe, expect, it } from "vitest";
import { buildHealthPayload } from "../src/health.js";

describe("buildHealthPayload", () => {
  it("只返回 status:ok", () => {
    expect(buildHealthPayload()).toEqual({ status: "ok" });
  });

  it("不包含任何会话或设备信息", () => {
    const serialized = JSON.stringify(buildHealthPayload());
    for (const leaked of ["session", "sessions", "sessionList", "mid", "name", "uptime", "time"]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it("字段数量固定为 1", () => {
    expect(Object.keys(buildHealthPayload())).toEqual(["status"]);
  });
});

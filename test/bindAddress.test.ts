import { describe, expect, it } from "vitest";
import { buildBindAddressWarning, isLoopbackHost } from "../src/bindAddress.js";

describe("isLoopbackHost", () => {
  it("识别本机回环地址", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("127.1.2.3")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("LOCALHOST")).toBe(true);
    expect(isLoopbackHost(" 127.0.0.1 ")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("")).toBe(true);
  });

  it("不把对外监听地址误判为回环", () => {
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("::")).toBe(false);
    expect(isLoopbackHost("192.168.1.10")).toBe(false);
    expect(isLoopbackHost("10.0.0.5")).toBe(false);
    expect(isLoopbackHost("172.17.0.2")).toBe(false);
  });
});

describe("buildBindAddressWarning", () => {
  it("回环地址给出 502 排查提示", () => {
    const warning = buildBindAddressWarning("127.0.0.1", 8765);
    expect(warning).toBeDefined();
    expect(warning).toContain("HOST=0.0.0.0");
    expect(warning).toContain("502");
  });

  it("对外监听不产生警告", () => {
    expect(buildBindAddressWarning("0.0.0.0", 8765)).toBeUndefined();
  });
});

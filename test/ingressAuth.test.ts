import { describe, expect, it } from "vitest";
import { buildIngressTokenStartupWarning, buildUnauthorizedUpgradeLog } from "../src/ingressAuth.js";

describe("buildIngressTokenStartupWarning", () => {
  it("说明两端都需要额外注入 token", () => {
    const warning = buildIngressTokenStartupWarning();
    expect(warning).toContain("桌面端");
    expect(warning).toContain("手机端");
    expect(warning).toContain("?token=");
  });

  it("给出两端各自的注入点", () => {
    const warning = buildIngressTokenStartupWarning();
    expect(warning).toContain("ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL");
    expect(warning).toContain("ZCODE_WEB_REMOTE_CONTROL_URL");
    expect(warning).toContain("?relay=");
  });

  it("给出只绑本机端口映射的替代方案", () => {
    expect(buildIngressTokenStartupWarning()).toContain("127.0.0.1:8765:8765");
  });

  it("不包含任何具体 token 值", () => {
    expect(buildIngressTokenStartupWarning()).not.toContain("eoe");
  });
});

describe("buildUnauthorizedUpgradeLog", () => {
  it("指明两种合法的 token 传递位置", () => {
    const log = buildUnauthorizedUpgradeLog();
    expect(log).toContain("Authorization: Bearer");
    expect(log).toContain("?token=");
  });

  it("不回显 token 值", () => {
    expect(buildUnauthorizedUpgradeLog()).not.toContain("eoe");
  });
});

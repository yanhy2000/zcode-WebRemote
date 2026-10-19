import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { RelayServer } from "../src/server.js";
import { calculateProof } from "../src/auth.js";
import type {
  WebRemoteControlRelayAuthAck,
  WebRemoteControlRelayAuthChallenge,
  WebRemoteControlRelayDataMessage,
  WebRemoteControlRelayDeviceRegisterAck,
  WebRemoteControlRelayError,
  WebRemoteControlRelayPairStatusAck,
} from "../src/types.js";

function getWsMessage<T>(ws: WebSocket): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for message")), 5000);
    ws.once("message", (raw) => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(raw.toString("utf8"));
        resolve(parsed as T);
      } catch (err) {
        reject(err);
      }
    });
  });
}

describe("Relay Server Integration", () => {
  let server: RelayServer;
  const testPort = 18765;
  const wsUrl = `ws://127.0.0.1:${testPort}/ws`;
  const passHash = "test_pass_hash_123456=";

  beforeAll(async () => {
    server = new RelayServer({
      port: testPort,
      host: "127.0.0.1",
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("handles HTTP health check endpoint", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/health`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { status: string; sessions: number };
    expect(data.status).toBe("ok");
    expect(data.sessions).toBe(0);
  });

  it("completes full lifecycle: Register -> Device Auth -> Terminal Auth -> Pair -> Forward Data -> KICK", async () => {
    // 1. Device 注册
    const deviceWs = new WebSocket(wsUrl);
    await new Promise((r) => deviceWs.on("open", r));

    deviceWs.send(
      JSON.stringify({
        type: "device_register_init",
        device_mid: "mid-1",
        pass_hash: passHash,
        meta: { platform: "win32", version: "3.15.1", name: "PC-1" },
        client_ts: Date.now(),
      }),
    );

    const regAck = await getWsMessage<WebRemoteControlRelayDeviceRegisterAck>(deviceWs);
    expect(regAck.type).toBe("device_register_ack");
    expect(regAck.device_sid).toMatch(/^d_/);
    const deviceSid = regAck.device_sid;

    // 2. Device 发起认证
    deviceWs.send(
      JSON.stringify({
        type: "auth_init",
        role: "device",
        device_sid: deviceSid,
        meta: { platform: "win32", version: "3.15.1", name: "PC-1" },
        client_ts: Date.now(),
      }),
    );

    const devChallenge = await getWsMessage<WebRemoteControlRelayAuthChallenge>(deviceWs);
    expect(devChallenge.type).toBe("auth_challenge");
    expect(devChallenge.nonce).toBeTruthy();

    const devProof = calculateProof(passHash, devChallenge.nonce, "device", deviceSid);
    deviceWs.send(
      JSON.stringify({
        type: "auth_response",
        device_sid: deviceSid,
        proof: devProof,
        client_ts: Date.now(),
      }),
    );

    const devAuthAck = await getWsMessage<WebRemoteControlRelayAuthAck>(deviceWs);
    expect(devAuthAck.type).toBe("auth_ack");
    expect(devAuthAck.pair_status).toBe("waiting");

    // 3. Terminal 手机端发起认证
    const termWs = new WebSocket(wsUrl);
    await new Promise((r) => termWs.on("open", r));

    termWs.send(
      JSON.stringify({
        type: "auth_init",
        role: "terminal",
        device_sid: deviceSid,
        meta: { platform: "web", version: "3.15.1", name: "mobile" },
        client_ts: Date.now(),
      }),
    );

    const termChallenge = await getWsMessage<WebRemoteControlRelayAuthChallenge>(termWs);
    expect(termChallenge.type).toBe("auth_challenge");
    expect(termChallenge.nonce).toBeTruthy();

    const termProof = calculateProof(passHash, termChallenge.nonce, "terminal", deviceSid);

    // 准备监听 Device 侧收到的 pair_status_ack ("matched")
    const devMatchedPromise = getWsMessage<WebRemoteControlRelayPairStatusAck>(deviceWs);

    termWs.send(
      JSON.stringify({
        type: "auth_response",
        device_sid: deviceSid,
        proof: termProof,
        client_ts: Date.now(),
      }),
    );

    const termAuthAck = await getWsMessage<WebRemoteControlRelayAuthAck>(termWs);
    expect(termAuthAck.type).toBe("auth_ack");
    expect(termAuthAck.pair_status).toBe("matched");
    expect(termAuthAck.terminal_sid).toMatch(/^t_/);

    const devMatched = await devMatchedPromise;
    expect(devMatched.type).toBe("pair_status_ack");
    expect(devMatched.pair_status).toBe("matched");

    // 4. 双向数据转发测试
    // Device -> Terminal
    const termDataPromise = getWsMessage<WebRemoteControlRelayDataMessage>(termWs);
    deviceWs.send(
      JSON.stringify({
        type: "data",
        payload: { message: "hello-from-device", zcode_type: "workspace-bridge-ready" },
        client_ts: Date.now(),
      }),
    );
    const termReceived = await termDataPromise;
    expect(termReceived.type).toBe("data");
    expect(termReceived.payload).toEqual({
      message: "hello-from-device",
      zcode_type: "workspace-bridge-ready",
    });

    // Terminal -> Device
    const devDataPromise = getWsMessage<WebRemoteControlRelayDataMessage>(deviceWs);
    termWs.send(
      JSON.stringify({
        type: "data",
        payload: { action: "prompt-submit", text: "how are you" },
        client_ts: Date.now(),
      }),
    );
    const devReceived = await devDataPromise;
    expect(devReceived.type).toBe("data");
    expect(devReceived.payload).toEqual({ action: "prompt-submit", text: "how are you" });

    // 5. 第二个 Terminal 接入触发冲突踢出 (KICKED)
    const termWs2 = new WebSocket(wsUrl);
    await new Promise((r) => termWs2.on("open", r));

    termWs2.send(
      JSON.stringify({
        type: "auth_init",
        role: "terminal",
        device_sid: deviceSid,
        meta: { platform: "web", version: "3.15.1", name: "mobile-2" },
      }),
    );
    const term2Challenge = await getWsMessage<WebRemoteControlRelayAuthChallenge>(termWs2);
    const term2Proof = calculateProof(passHash, term2Challenge.nonce, "terminal", deviceSid);

    const term1KickedPromise = getWsMessage<WebRemoteControlRelayError>(termWs);
    termWs2.send(
      JSON.stringify({
        type: "auth_response",
        device_sid: deviceSid,
        proof: term2Proof,
      }),
    );

    // 旧终端应收到 KICKED
    const term1Error = await term1KickedPromise;
    expect(term1Error.type).toBe("error");
    expect(term1Error.code).toBe("KICKED");

    // 新终端收到 matched
    const term2AuthAck = await getWsMessage<WebRemoteControlRelayAuthAck>(termWs2);
    expect(term2AuthAck.type).toBe("auth_ack");
    expect(term2AuthAck.pair_status).toBe("matched");

    deviceWs.close();
    termWs2.close();
  });
});

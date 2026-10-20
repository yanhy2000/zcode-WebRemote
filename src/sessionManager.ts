import type { WebSocket } from "ws";
import { generateDeviceSid, generateNonce } from "./auth.js";
import { RelayConnection, RelaySession } from "./session.js";
import type {
  WebRemoteControlRelayAuthInit,
  WebRemoteControlRelayAuthResponse,
  WebRemoteControlRelayDataMessage,
  WebRemoteControlRelayDeviceRegisterInit,
  WebRemoteControlRelayMessage,
  WebRemoteControlRelayPairStatusQuery,
} from "./types.js";
import { WebRemoteControlCloseCodes } from "./types.js";

export interface SessionManagerOptions {
  sessionTtlMs?: number;
  logger?: {
    debug(msg: string, extra?: unknown): void;
    info(msg: string, extra?: unknown): void;
    warn(msg: string, extra?: unknown): void;
    error(msg: string, extra?: unknown): void;
  };
}

export class SessionManager {
  private readonly sessions = new Map<string, RelaySession>();
  private readonly socketMap = new WeakMap<
    WebSocket,
    { session: RelaySession; conn: RelayConnection }
  >();
  private readonly sessionTtlMs: number;
  private readonly logger: SessionManagerOptions["logger"];
  private cleanupTimer?: NodeJS.Timeout;

  constructor(options: SessionManagerOptions = {}) {
    this.sessionTtlMs = options.sessionTtlMs ?? 24 * 60 * 60 * 1000; // 默认 24 小时空闲超时
    this.logger = options.logger;

    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 60_000);
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  getSessionSummaries(): Array<{
    deviceSid: string;
    mid?: string;
    name?: string;
    status: string;
    hasDevice: boolean;
    hasTerminal: boolean;
    createdAt: number;
  }> {
    const list = [];
    for (const [sid, session] of this.sessions.entries()) {
      list.push({
        deviceSid: sid,
        mid: session.deviceMid,
        name: session.meta?.name,
        status: session.pairStatus,
        hasDevice: Boolean(session.deviceConn?.authenticated),
        hasTerminal: Boolean(session.terminalConn?.authenticated),
        createdAt: session.createdAt,
      });
    }
    return list;
  }

  getSession(deviceSid: string): RelaySession | undefined {
    return this.sessions.get(deviceSid);
  }

  registerDevice(
    ws: WebSocket,
    init: WebRemoteControlRelayDeviceRegisterInit,
  ): RelaySession {
    const deviceSid = generateDeviceSid();
    const session = new RelaySession(
      deviceSid,
      init.pass_hash,
      init.device_mid,
      init.meta,
    );
    this.sessions.set(deviceSid, session);
    this.logger?.info(`[relay] Device registered`, {
      deviceSid,
      mid: init.device_mid,
      name: init.meta?.name,
    });

    // 回复 register_ack
    ws.send(
      JSON.stringify({
        type: "device_register_ack",
        device_sid: deviceSid,
        server_ts: Date.now(),
      }),
    );

    return session;
  }

  handleMessage(ws: WebSocket, rawData: unknown): void {
    let rawStr: string;
    if (typeof rawData === "string") {
      rawStr = rawData;
    } else if (Buffer.isBuffer(rawData)) {
      rawStr = rawData.toString("utf8");
    } else if (rawData instanceof ArrayBuffer) {
      rawStr = Buffer.from(rawData).toString("utf8");
    } else {
      rawStr = String(rawData);
    }

    let message: WebRemoteControlRelayMessage;
    try {
      message = JSON.parse(rawStr);
    } catch {
      this.logger?.warn("[relay] Invalid JSON frame received");
      return;
    }

    if (!message || typeof message !== "object" || !("type" in message)) {
      return;
    }

    switch (message.type) {
      case "device_register_init":
        this.registerDevice(ws, message);
        break;

      case "auth_init":
        this.handleAuthInit(ws, message);
        break;

      case "auth_response":
        this.handleAuthResponse(ws, message);
        break;

      case "pair_status_query":
        this.handlePairStatusQuery(ws, message);
        break;

      case "data":
        this.handleData(ws, message);
        break;

      default:
        this.logger?.debug("[relay] Unhandled message type", { type: (message as { type: string }).type });
        break;
    }
  }

  private handleAuthInit(ws: WebSocket, msg: WebRemoteControlRelayAuthInit): void {
    const session = this.sessions.get(msg.device_sid);
    if (!session) {
      this.logger?.warn("[relay] auth_init session not found", {
        deviceSid: msg.device_sid,
        role: msg.role,
      });
      this.sendError(ws, "AUTH_FAILED", "Device session not found");
      ws.close(WebRemoteControlCloseCodes.SessionNotFound, "SESSION_NOT_FOUND");
      return;
    }

    session.touch();
    const nonce = generateNonce();
    let conn: RelayConnection;

    if (msg.role === "device") {
      conn = session.attachDevice(ws, msg.meta);
    } else {
      conn = session.attachTerminal(ws, msg.meta);
    }

    conn.nonce = nonce;
    this.socketMap.set(ws, { session, conn });

    // 下发 challenge
    ws.send(
      JSON.stringify({
        type: "auth_challenge",
        nonce,
        server_ts: Date.now(),
      }),
    );
  }

  private handleAuthResponse(ws: WebSocket, msg: WebRemoteControlRelayAuthResponse): void {
    const binding = this.socketMap.get(ws);
    if (!binding || !binding.conn.nonce) {
      this.sendError(ws, "AUTH_FAILED", "Invalid auth handshake state");
      ws.close();
      return;
    }

    const nonce = binding.conn.nonce;
    const { session, conn } = binding;
    session.touch();

    const ok = session.verifyAuthProof(conn.role, nonce, msg.proof);
    if (!ok) {
      this.logger?.warn("[relay] Auth proof failed", {
        deviceSid: session.deviceSid,
        role: conn.role,
      });
      this.sendError(ws, "AUTH_FAILED", "Invalid HMAC signature");
      ws.close();
      return;
    }

    conn.authenticated = true;

    if (conn.role === "terminal") {
      session.commitTerminal(conn);
    }

    this.logger?.info(`[relay] ${conn.role} authenticated`, {
      deviceSid: session.deviceSid,
      pairStatus: session.pairStatus,
    });

    // 响应 auth_ack
    ws.send(
      JSON.stringify({
        type: "auth_ack",
        device_sid: session.deviceSid,
        ...(conn.terminalSid ? { terminal_sid: conn.terminalSid } : {}),
        pair_status: session.pairStatus,
        server_ts: Date.now(),
      }),
    );

    // 如果状态变成了 matched，同步通知两端
    if (session.pairStatus === "matched") {
      session.notifyPairStatus();
    }
  }

  private handlePairStatusQuery(ws: WebSocket, msg: WebRemoteControlRelayPairStatusQuery): void {
    const session = this.sessions.get(msg.device_sid);
    if (!session) {
      this.sendError(ws, "AUTH_FAILED", "Session not found");
      ws.close(WebRemoteControlCloseCodes.SessionNotFound);
      return;
    }

    session.touch();
    const binding = this.socketMap.get(ws);
    const terminalSid =
      binding?.conn.role === "terminal"
        ? binding.conn.terminalSid
        : session.terminalConn?.terminalSid;

    ws.send(
      JSON.stringify({
        type: "pair_status_ack",
        terminal_sid: terminalSid,
        pair_status: session.pairStatus,
        server_ts: Date.now(),
      }),
    );
  }

  private handleData(ws: WebSocket, msg: WebRemoteControlRelayDataMessage): void {
    const binding = this.socketMap.get(ws);
    if (!binding || !binding.conn.authenticated) {
      this.sendError(ws, "INTERNAL", "Connection not authenticated");
      return;
    }

    const { session, conn } = binding;
    session.touch();

    if (session.pairStatus !== "matched") {
      if (conn.role === "terminal" && !session.deviceConn?.authenticated) {
        this.sendError(ws, "DEVICE_OFFLINE", "Desktop device is offline");
      } else {
        this.sendError(ws, "INTERNAL", "Peer connection not ready");
      }
      return;
    }

    // 严禁打印 payload 内容，保障用户隐私
    const forwarded: WebRemoteControlRelayDataMessage = {
      type: "data",
      payload: msg.payload,
      client_ts: msg.client_ts,
      server_ts: Date.now(),
    };

    if (conn.role === "device") {
      session.sendToTerminal(forwarded);
    } else {
      session.sendToDevice(forwarded);
    }
  }

  handleClose(ws: WebSocket): void {
    const binding = this.socketMap.get(ws);
    if (binding) {
      const { session, conn } = binding;
      this.logger?.info(`[relay] ${conn.role} disconnected`, {
        deviceSid: session.deviceSid,
      });
      session.handleDisconnect(ws);
      this.socketMap.delete(ws);
    }
  }

  private sendError(ws: WebSocket, code: import("./types.js").WebRemoteControlRelayErrorCode, message: string): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(
        JSON.stringify({
          type: "error",
          code,
          message,
          server_ts: Date.now(),
        }),
      );
    }
  }

  private cleanup(): void {
    for (const [sid, session] of this.sessions.entries()) {
      if (session.isDead(this.sessionTtlMs)) {
        this.logger?.info(`[relay] Session expired and pruned`, { deviceSid: sid });
        this.sessions.delete(sid);
      }
    }
  }
}

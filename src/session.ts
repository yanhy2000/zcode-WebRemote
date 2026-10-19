import type { WebSocket } from "ws";
import {
  calculateProof,
  generateTerminalSid,
  verifyProof,
} from "./auth.js";
import type {
  WebRemoteControlRelayDeviceMeta,
  WebRemoteControlRelayErrorCode,
  WebRemoteControlRelayMessage,
  WebRemoteControlRelayPairStatus,
  WebRemoteControlRelayRole,
} from "./types.js";
import { WebRemoteControlCloseCodes } from "./types.js";

export interface RelayConnection {
  ws: WebSocket;
  role: WebRemoteControlRelayRole;
  nonce?: string;
  authenticated: boolean;
  terminalSid?: string;
  meta?: WebRemoteControlRelayDeviceMeta;
  lastActiveAt: number;
}

export class RelaySession {
  readonly deviceSid: string;
  passHash: string;
  deviceMid?: string;
  meta?: WebRemoteControlRelayDeviceMeta;
  createdAt: number;
  lastActiveAt: number;

  deviceConn?: RelayConnection;
  terminalConn?: RelayConnection;

  constructor(deviceSid: string, passHash: string, deviceMid?: string, meta?: WebRemoteControlRelayDeviceMeta) {
    this.deviceSid = deviceSid;
    this.passHash = passHash;
    this.deviceMid = deviceMid;
    this.meta = meta;
    this.createdAt = Date.now();
    this.lastActiveAt = Date.now();
  }

  get pairStatus(): WebRemoteControlRelayPairStatus {
    if (this.deviceConn?.authenticated && this.terminalConn?.authenticated) {
      return "matched";
    }
    return "waiting";
  }

  touch(): void {
    this.lastActiveAt = Date.now();
  }

  attachDevice(ws: WebSocket, meta?: WebRemoteControlRelayDeviceMeta): RelayConnection {
    this.touch();
    if (this.deviceConn && this.deviceConn.ws !== ws) {
      try {
        this.deviceConn.ws.close();
      } catch {
        // ignore
      }
    }
    const conn: RelayConnection = {
      ws,
      role: "device",
      authenticated: false,
      meta,
      lastActiveAt: Date.now(),
    };
    this.deviceConn = conn;
    return conn;
  }

  attachTerminal(ws: WebSocket, meta?: WebRemoteControlRelayDeviceMeta): RelayConnection {
    this.touch();
    const conn: RelayConnection = {
      ws,
      role: "terminal",
      authenticated: false,
      terminalSid: generateTerminalSid(),
      meta,
      lastActiveAt: Date.now(),
    };
    return conn;
  }

  commitTerminal(conn: RelayConnection): void {
    this.touch();
    if (this.terminalConn && this.terminalConn.ws !== conn.ws) {
      // 踢出旧 Terminal
      try {
        this.sendErrorTo(this.terminalConn.ws, "KICKED", "A newer terminal connection has taken over this remote session.");
        this.terminalConn.ws.close(WebRemoteControlCloseCodes.SessionConflict, "KICKED");
      } catch {
        // ignore
      }
    }
    this.terminalConn = conn;
  }

  verifyAuthProof(role: WebRemoteControlRelayRole, nonce: string, proof: string): boolean {
    const expected = calculateProof(this.passHash, nonce, role, this.deviceSid);
    return verifyProof(expected, proof);
  }

  sendToDevice(message: WebRemoteControlRelayMessage): boolean {
    if (this.deviceConn && this.deviceConn.ws.readyState === this.deviceConn.ws.OPEN) {
      this.deviceConn.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  sendToTerminal(message: WebRemoteControlRelayMessage): boolean {
    if (this.terminalConn && this.terminalConn.ws.readyState === this.terminalConn.ws.OPEN) {
      this.terminalConn.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  sendErrorTo(ws: WebSocket, code: WebRemoteControlRelayErrorCode, message: string): void {
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

  notifyPairStatus(): void {
    const status = this.pairStatus;
    const terminalSid = this.terminalConn?.terminalSid;

    if (this.deviceConn?.authenticated) {
      this.sendToDevice({
        type: "pair_status_ack",
        terminal_sid: terminalSid,
        pair_status: status,
        server_ts: Date.now(),
      });
    }

    if (this.terminalConn?.authenticated) {
      this.sendToTerminal({
        type: "pair_status_ack",
        terminal_sid: terminalSid,
        pair_status: status,
        server_ts: Date.now(),
      });
    }
  }

  handleDisconnect(ws: WebSocket): void {
    this.touch();
    if (this.deviceConn?.ws === ws) {
      this.deviceConn = undefined;
      // 通知 Terminal 当前 Device 离线，状态回退为 waiting
      if (this.terminalConn?.authenticated) {
        this.sendToTerminal({
          type: "pair_status_ack",
          terminal_sid: this.terminalConn.terminalSid,
          pair_status: "waiting",
          server_ts: Date.now(),
        });
      }
    } else if (this.terminalConn?.ws === ws) {
      this.terminalConn = undefined;
      // 通知 Device 手机端已断开，状态回退为 waiting
      if (this.deviceConn?.authenticated) {
        this.sendToDevice({
          type: "pair_status_ack",
          pair_status: "waiting",
          server_ts: Date.now(),
        });
      }
    }
  }

  isDead(ttlMs: number): boolean {
    // 若两端均无活动连接且已超时
    const hasActiveWs =
      (this.deviceConn && this.deviceConn.ws.readyState === this.deviceConn.ws.OPEN) ||
      (this.terminalConn && this.terminalConn.ws.readyState === this.terminalConn.ws.OPEN);
    return !hasActiveWs && Date.now() - this.lastActiveAt > ttlMs;
  }
}

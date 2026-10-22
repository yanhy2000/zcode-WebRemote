import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, createReadStream, statSync } from "node:fs";
import { join, extname } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { buildBindAddressWarning } from "./bindAddress.js";
import { buildIngressTokenStartupWarning, buildUnauthorizedUpgradeLog } from "./ingressAuth.js";
import { SessionManager } from "./sessionManager.js";

export interface RelayServerOptions {
  port?: number;
  host?: string;
  staticDir?: string;
  authToken?: string;
  sessionTtlMs?: number;
  logger?: {
    debug(msg: string, extra?: unknown): void;
    info(msg: string, extra?: unknown): void;
    warn(msg: string, extra?: unknown): void;
    error(msg: string, extra?: unknown): void;
  };
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
};

export class RelayServer {
  readonly port: number;
  readonly host: string;
  readonly staticDir?: string;
  readonly authToken?: string;
  readonly sessionManager: SessionManager;
  private readonly logger: RelayServerOptions["logger"];

  private httpServer?: ReturnType<typeof createServer>;
  private wss?: WebSocketServer;

  constructor(options: RelayServerOptions = {}) {
    this.port = options.port ?? 8765;
    this.host = options.host ?? "0.0.0.0";
    this.staticDir = options.staticDir;
    this.authToken = options.authToken?.trim() || undefined;
    this.logger = options.logger ?? {
      debug: (msg, extra) => console.debug(msg, extra ?? ""),
      info: (msg, extra) => console.log(msg, extra ?? ""),
      warn: (msg, extra) => console.warn(msg, extra ?? ""),
      error: (msg, extra) => console.error(msg, extra ?? ""),
    };

    this.sessionManager = new SessionManager({
      sessionTtlMs: options.sessionTtlMs,
      logger: this.logger,
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      const server = createServer((req, res) => {
        this.handleHttpRequest(req, res);
      });

      const wss = new WebSocketServer({ noServer: true });
      this.wss = wss;

      server.on("upgrade", (req, socket, head) => {
        this.handleUpgrade(req, socket, head);
      });

      wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
        this.handleWsConnection(ws, req);
      });

      this.httpServer = server;
      server.listen(this.port, this.host, () => {
        this.logger?.info(`[relay] Server listening on http://${this.host}:${this.port}`);
        this.logger?.info(`[relay] WebSocket endpoint: ws://${this.host}:${this.port}/ws`);
        // 监听在 loopback 上时，容器端口映射和反向代理都连不进来，
        // 提前喊出来，避免排查方向跑偏到网络/证书上。
        const bindWarning = buildBindAddressWarning(this.host, this.port);
        if (bindWarning) {
          this.logger?.warn(bindWarning);
        }
        if (this.authToken) {
          this.logger?.info(`[relay] Ingress token authentication enabled`);
          this.logger?.warn(buildIngressTokenStartupWarning());
        }
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.sessionManager.dispose();
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close();
      }
      if (this.httpServer) {
        this.httpServer.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private handleUpgrade(req: IncomingMessage, socket: any, head: Buffer): void {
    const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    // 仅响应 /ws 或 /ws/
    if (pathname !== "/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    // 可选的接入 Token 校验
    if (this.authToken) {
      const authHeader = req.headers["authorization"]?.trim();
      const queryToken = url.searchParams.get("token")?.trim();
      const token =
        authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : queryToken;

      if (token !== this.authToken) {
        this.logger?.warn(buildUnauthorizedUpgradeLog());
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    this.wss?.handleUpgrade(req, socket, head, (ws) => {
      this.wss?.emit("connection", ws, req);
    });
  }

  private handleWsConnection(ws: WebSocket, req: IncomingMessage): void {
    const remoteIp = req.socket.remoteAddress;
    this.logger?.debug(`[relay] Incoming WebSocket connection from ${remoteIp}`);

    ws.on("message", (data) => {
      try {
        this.sessionManager.handleMessage(ws, data);
      } catch (err) {
        this.logger?.error("[relay] Exception in handleMessage", err);
      }
    });

    ws.on("close", () => {
      this.sessionManager.handleClose(ws);
    });

    ws.on("error", (err) => {
      this.logger?.warn("[relay] WebSocket client error", { error: err.message });
      this.sessionManager.handleClose(ws);
    });
  }

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // 健康检查端点
    if (pathname === "/health" || pathname === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          sessions: this.sessionManager.getSessionCount(),
          sessionList: this.sessionManager.getSessionSummaries(),
          uptime: process.uptime(),
          time: new Date().toISOString(),
        }),
      );
      return;
    }

    // 静态文件服务
    if (this.staticDir && existsSync(this.staticDir)) {
      let relativePath = pathname === "/" ? "/index.html" : pathname;
      let filePath = join(this.staticDir, relativePath);

      // SPA 路由回退：如果访问 /remote/v4 路径但对应文件不存在，尝试寻找 /remote/v4/index.html
      if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
        const spaIndex = join(this.staticDir, "remote", "v4", "index.html");
        const rootIndex = join(this.staticDir, "index.html");
        if (pathname.startsWith("/remote") && existsSync(spaIndex)) {
          filePath = spaIndex;
        } else if (existsSync(rootIndex)) {
          filePath = rootIndex;
        }
      }

      if (existsSync(filePath) && !statSync(filePath).isDirectory()) {
        const ext = extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": contentType });
        createReadStream(filePath).pipe(res);
        return;
      }
    }

    // 默认自托管欢迎页
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>ZCode Remote Relay</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #1e293b; padding: 2.5rem; border-radius: 1rem; border: 1px solid #334155; max-width: 500px; box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.5); }
    h1 { margin-top: 0; color: #38bdf8; font-size: 1.5rem; display: flex; align-items: center; gap: 0.5rem; }
    p { color: #94a3b8; line-height: 1.6; }
    .status { display: inline-flex; align-items: center; gap: 0.5rem; background: #064e3b; color: #34d399; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.875rem; font-weight: 500; }
    .dot { width: 8px; height: 8px; background: #10b981; border-radius: 50%; }
    code { background: #0f172a; padding: 0.2rem 0.4rem; border-radius: 0.25rem; font-family: monospace; color: #f1f5f9; }
  </style>
</head>
<body>
  <div class="card">
    <div style="margin-bottom: 1rem;"><span class="status"><span class="dot"></span> Relay 正常运行中</span></div>
    <h1>ZCode Remote Gateway</h1>
    <p>当前自托管中继服务正常工作。WebSocket 中继端点位于 <code>/ws</code>。</p>
    <p>请在您的 ZCode 桌面端配置环境变量即可配对连接：</p>
    <pre style="background: #0f172a; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; font-size: 0.85rem; color: #38bdf8;">ZCODE_WEB_REMOTE_CONTROL_RELAY_WS_URL=wss://&lt;your-domain&gt;/ws</pre>
  </div>
</body>
</html>
    `);
  }
}

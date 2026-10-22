import process from "node:process";
import { resolveHealthDetailsFlag } from "./health.js";
import { RelayServer } from "./server.js";

const port = Number(process.env.PORT) || 8765;
const host = process.env.HOST || "0.0.0.0";
const staticDir = process.env.STATIC_DIR || "./public";
const authToken = process.env.RELAY_AUTH_TOKEN;
const healthDetails = resolveHealthDetailsFlag(process.env.HEALTH_DETAILS);
const sessionTtlMs = process.env.SESSION_TTL_MS
  ? Number(process.env.SESSION_TTL_MS)
  : undefined;

const server = new RelayServer({
  port,
  host,
  staticDir,
  authToken,
  healthDetails,
  sessionTtlMs,
});

async function main() {
  await server.start();

  const shutdown = async (signal: string) => {
    console.log(`\n[relay] Received ${signal}, shutting down gracefully...`);
    await server.stop();
    console.log("[relay] Server stopped.");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[relay] Failed to start relay server:", err);
  process.exit(1);
});

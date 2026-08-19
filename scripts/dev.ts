#!/usr/bin/env bun
/** Dev helper: run API server + Vite client together on Windows/macOS/Linux */
import { spawn } from "bun";

const server = spawn(["bun", "--watch", "server/index.ts"], {
  stdout: "inherit",
  stderr: "inherit",
  env: { ...process.env, PORT: "3001" },
});

const client = spawn(["bunx", "vite"], {
  stdout: "inherit",
  stderr: "inherit",
});

const shutdown = () => {
  server.kill();
  client.kill();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await Promise.race([server.exited, client.exited]);
shutdown();

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { join } from "path";
import { validateEnv } from "./env";
import { createDb, UPLOADS_DIR, DATA_DIR } from "./db";

validateEnv();
import { authMiddleware, handleAuthMe, handleLogin, handleLogout, initAuth, type AuthUser } from "./auth";
import { registerRoutes, renumberAttemptPeers, recomputeRecipientAndCaseStatus, logAuditEvent } from "./routes";
import { auth as betterAuthInstance } from "./auth-better";
import { reconcileLostServes } from "./lib/reconciler";
import { invalidateExecutionsForCase } from "./affidavitExecution";
import { checkpointWal } from "./db";
import { computePayloadFingerprint } from "./serveFingerprint";
import { isHotBufferMock } from "./lib/hotBuffer";

const db = createDb();
initAuth(db);

type AppEnv = { Variables: { user: AuthUser } };
const app = new Hono<AppEnv>();

const defaultOrigins = [
  "https://servetracker-beta-sillyhippy.zocomputer.io",
  "https://servetracker-sillyhippy.zocomputer.io",
  "https://sillyhippy.zo.space",
  "http://localhost:3151",
  "http://localhost:3150",
  "http://localhost:5173",
  "http://localhost:3001",
];

const corsOrigins = process.env.CORS_ORIGIN
  ? [...defaultOrigins, ...process.env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean)]
  : defaultOrigins;

app.use(
  "*",
  cors({
    origin: corsOrigins,
    credentials: true,
  })
);

app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (url.pathname.startsWith("/servetracker-staging/") || url.pathname.startsWith("/servetracker/")) {
    const newPathname = url.pathname.replace(/^\/servetracker(-staging)?/, "");
    // If it's an api or upload route, forward internal request
    if (newPathname.startsWith("/api/") || newPathname.startsWith("/uploads/")) {
      const rewrittenUrl = new URL(newPathname + url.search, url.origin);
      const req = new Request(rewrittenUrl.toString(), c.req.raw);
      return app.fetch(req);
    }
  }
  await next();
});

app.use("*", async (c, next) => {
  await next();

  if (c.res.headers.has("Cache-Control")) return;

  const path = c.req.path;

  if (path.startsWith("/api/")) {
    c.header("Cache-Control", "no-store");
    return;
  }

  if (path.startsWith("/uploads/")) {
    c.header("Cache-Control", "public, max-age=86400");
    return;
  }

  if (/\.(js|css|woff2?|png|jpe?g|gif|svg|ico|webp)$/i.test(path)) {
    c.header("Cache-Control", "no-cache");
    return;
  }

  c.header("Cache-Control", "no-cache");
});

app.use("*", authMiddleware());

app.post("/api/auth/login", handleLogin);
app.post("/api/auth/logout", handleLogout);
app.get("/api/auth/me", handleAuthMe);

// ServeTracker-owned /api/auth/* routes MUST register before Better-Auth's
// catch-all. Hono first-match would otherwise send /register-server,
// /forgot-password, /reset-password, and /consent to Better-Auth (empty 404),
// which is why manual /join signup failed while Google OAuth still worked.
registerRoutes(app, db);

app.all("/api/auth/*", (c) => betterAuthInstance.handler(c.req.raw));

// STRICT ISOLATION: Only serve photo evidence publicly for email links & affidavits.
// Legal court documents require authenticated API streaming via /api/cases/:id/documents/...
const SERVES_UPLOADS_DIR = join(UPLOADS_DIR, "serves");
app.use("/uploads/serves/*", serveStatic({ root: SERVES_UPLOADS_DIR, rewriteRequestPath: (path) => path.replace(/^\/uploads\/serves/, "") }));
app.all("/uploads/documents/*", (c) => c.json({ error: "Unauthorized: Direct document access blocked" }, 403));
app.all("/uploads/*", (c) => c.text("Not Found", 404));
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

const distPath = join(import.meta.dir, "..", "dist");
app.use("/*", serveStatic({
  root: distPath,
  rewriteRequestPath: (path) => path.replace(/^\/servetracker(-staging)?/, "")
}));

app.get("*", async (c) => {
  const indexFile = Bun.file(join(distPath, "index.html"));
  if (await indexFile.exists()) {
    return c.html(await indexFile.text());
  }
  return c.text("PDFUSAEDIT API running. Build the frontend with `bun run build`.", 200);
});

app.onError((err, c) => {
  console.error("[api] unhandled:", err);
  const path = (() => {
    try {
      return new URL(c.req.url).pathname;
    } catch {
      return c.req.path || "";
    }
  })();
  if (path.includes("/api/")) {
    return c.json({ error: err instanceof Error ? err.message : "Internal Server Error" }, 500);
  }
  return c.text("Internal Server Error", 500);
});

const port = Number(process.env.PORT) || 3150;

// Dual-Shield self-heal: R2 is only a TEMPORARY hot buffer. Every attempt is
// archived there before the local SQLite commit, so if the commit was lost the
// row must come back on its own. Runs at boot and every 2 minutes, lock-aware,
// and never restores an id that has an off-box deletion tombstone.
const runDualShieldReconcile = (tag: string) => {
  reconcileLostServes(db, {
    renumberAttemptPeers,
    recomputeRecipientAndCaseStatus,
    invalidateExecutionsForCase,
    logAuditEvent,
    checkpointWal,
    computePayloadFingerprint,
  })
    .then((stats) => {
      if (stats.recovered > 0 || stats.errors > 0) {
        console.log(`[Dual-Shield] ${tag} reconcile:`, JSON.stringify(stats));
      }
    })
    .catch((err) => console.warn(`[Dual-Shield] ${tag} reconcile skipped:`, err));
};

// DISABLED 2026-09-20: R2 currently holds 337 test-suite archives and the
// bucket lifecycle was never verified against a real field serve. Restoring
// them floods production with mock attempts and fires real SMS/push alerts.
// Re-enable only after the R2 prefix is audited clean (scripts/audit-r2-prefix).
const RECONCILE_ENABLED = process.env.DUALSHIELD_RECONCILE === "on";
if (RECONCILE_ENABLED && !isHotBufferMock()) {
  setTimeout(() => runDualShieldReconcile("boot"), 1500);
  setInterval(() => runDualShieldReconcile("interval"), 2 * 60 * 1000);
}

console.log(`PDFUSAEDIT server listening on http://localhost:${port}`);
console.log(`Database: ${join(DATA_DIR, "pdfusaedit.db")}`);
console.log(`Uploads: ${UPLOADS_DIR}`);

// Automatic background retention cleanup on start + every 6 hours
try {
  import("./notifications").then(({ cleanOldNotifications }) => {
    cleanOldNotifications(db);
    setInterval(() => cleanOldNotifications(db), 6 * 60 * 60 * 1000);
  });
} catch {
  // ignore
}

// Graceful shutdown lifecycle: capture emergency SQLite snapshot before Zo container halts
let isShuttingDown = false;
const handleGracefulShutdown = (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[*] ${signal} received: flushing SQLite WAL and capturing emergency snapshot...`);
  try {
    checkpointWal(db);
    const snapDir = join(DATA_DIR, "snapshots");
    import("fs").then((fs) => {
      if (!fs.existsSync(snapDir)) fs.mkdirSync(snapDir, { recursive: true });
      const snapPath = join(snapDir, `emergency-shutdown-${Date.now()}.db`);
      db.exec(`VACUUM INTO '${snapPath}';`);
      console.log(`[+] Emergency shutdown snapshot verified at ${snapPath}`);
    });
  } catch (err) {
    console.error("[!] Emergency shutdown flush failed:", err);
  } finally {
    setTimeout(() => process.exit(0), 1500);
  }
};
process.on("SIGTERM", () => handleGracefulShutdown("SIGTERM"));
process.on("SIGINT", () => handleGracefulShutdown("SIGINT"));

export { app };

export default {
  port,
  fetch: app.fetch,
};

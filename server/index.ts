import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { join } from "path";
import { validateEnv } from "./env";
import { createDb, UPLOADS_DIR, DATA_DIR } from "./db";

validateEnv();
import { authMiddleware, handleAuthMe, handleLogin, handleLogout, initAuth, type AuthUser } from "./auth";
import { registerRoutes } from "./routes";

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

registerRoutes(app, db);

// Use UPLOADS_DIR so static uploads are strictly isolated to data/uploads
app.use("/uploads/*", serveStatic({ root: UPLOADS_DIR, rewriteRequestPath: (path) => path.replace(/^\/uploads/, "") }));
app.all("/uploads/*", (c) => c.text("Not Found", 404));
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

const distPath = join(import.meta.dir, "..", "dist");
app.use("/*", serveStatic({ root: distPath }));

app.get("*", async (c) => {
  const indexFile = Bun.file(join(distPath, "index.html"));
  if (await indexFile.exists()) {
    return c.html(await indexFile.text());
  }
  return c.text("PDFUSAEDIT API running. Build the frontend with `bun run build`.", 200);
});

const port = Number(process.env.PORT) || 3150;

console.log(`PDFUSAEDIT server listening on http://localhost:${port}`);
console.log(`Database: ${join(DATA_DIR, "pdfusaedit.db")}`);
console.log(`Uploads: ${UPLOADS_DIR}`);

export { app };

export default {
  port,
  fetch: app.fetch,
};

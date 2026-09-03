import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// MUST run before importing the server so it builds a fresh temp DB.
export const DATA_DIR = mkdtempSync(join(tmpdir(), "st-suite-"));
process.env.DATA_DIR = DATA_DIR;
process.env.APP_PASSWORD = "TestAdminPass123!";
process.env.SESSION_COOKIE_NAME = "serve_tracker_session_test";
process.env.DISABLE_EMAIL = "true";
process.env.MOCK_EMAIL = "true";
process.env.HELCIM_MOCK = "true";
process.env.HELCIM_WEBHOOK_SECRET = "staging-helcim-webhook-secret";
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = "9";
process.env.PORT = "39991";

// Seeded admin in test suite uses changed password to satisfy must_change_password=1
const mod = await import("../server/index");
const honoApp = mod.app as { fetch: (req: Request) => Promise<Response> };
export const app = honoApp.fetch.bind(honoApp);

// Automatically clear must_change_password for the seeded test admin in test suite
try {
  const { Database } = await import("bun:sqlite");
  const testDb = new Database(join(DATA_DIR, "pdfusaedit.db"));
  testDb.run("UPDATE users SET must_change_password = 0 WHERE id = 'usr_admin_default'");
  testDb.close();
} catch (e) {
  // ignore
}

export type HttpResult = {
  status: number;
  data: any;
  headers: Headers;
};

export class Client {
  cookies = new Map<string, string>();
  bearer?: string;

  private jar(res: Response) {
    const setCookies: string[] = (res.headers as any).getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const [pair] = sc.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }

  async req(method: string, path: string, body?: unknown): Promise<HttpResult> {
    const headers: Record<string, string> = {};
    const cookie = [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers["Cookie"] = cookie;
    if (this.bearer) headers["Authorization"] = `Bearer ${this.bearer}`;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) {
      payload = body;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await app(new Request(`http://test.local${path}`, { method, headers, body: payload }));
    this.jar(res);
    const text = await res.text();
    let data: any = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // keep raw text
    }
    return { status: res.status, data, headers: res.headers };
  }

  get(p: string) { return this.req("GET", p); }
  post(p: string, b?: unknown) { return this.req("POST", p, b); }
  put(p: string, b?: unknown) { return this.req("PUT", p, b); }
  patch(p: string, b?: unknown) { return this.req("PATCH", p, b); }
  del(p: string) { return this.req("DELETE", p); }
  delete(p: string) { return this.req("DELETE", p); }
}

export function expectStatus(r: HttpResult, wanted: number, msg = "") {
  if (r.status !== wanted) {
    throw new Error(`${msg}: expected status ${wanted}, got ${r.status} :: ${JSON.stringify(r.data).slice(0, 300)}`);
  }
}

/** Valid tiny PNG (1x1 transparent). */
export const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export const PNG_MAGIC = "89504e470d0a1a0a";

export function dataUrl(pngBase64: string, mime = "image/png") {
  return `data:${mime};base64,${pngBase64}`;
}

export function errOf(r: HttpResult): string {
  return String((r.data && (r.data.error || r.data.message)) || JSON.stringify(r.data));
}

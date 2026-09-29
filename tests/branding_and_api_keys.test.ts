import { describe, expect, test, beforeAll } from "bun:test";
import { join } from "path";
import { Database } from "bun:sqlite";
import { Client, DATA_DIR, expectStatus } from "./helpers";
import { verifyApiKey } from "../server/apiKeyAuth";

describe("Branding Settings and API Key Manager APIs", () => {
  let admin: Client;
  let db: Database;

  beforeAll(async () => {
    db = new Database(join(DATA_DIR, "pdfusaedit.db"));
    admin = new Client();
    const loginRes = await admin.post("/api/auth/login", {
      username: "admin",
      password: "TestAdminPass123!",
    });
    expectStatus(loginRes, 200);
  });

  test("GET /api/org/settings returns default branding when empty", async () => {
    const res = await admin.get("/api/org/settings");
    expect(res.status).toBe(200);
    expect(res.data.branding).toBeDefined();
    expect(res.data.branding.companyName).toBe("JUST LEGAL SOLUTIONS");
    expect(res.data.emailStatus).toBeDefined();
  });

  test("PUT /api/org/settings saves custom branding and email configuration", async () => {
    const payload = {
      branding: {
        companyName: "Acme Legal Process",
        contactPhone: "555-999-0000",
        dispatchEmail: "dispatch@acmelegal.test",
        logoUrl: "data:image/png;base64,iVBORw0KGgo=",
        omitAffidavitFooter: true,
      },
      email: {
        resendApiKey: "re_test_key_123",
        resendFromEmail: "notices@acmelegal.test",
      },
    };

    const putRes = await admin.put("/api/org/settings", payload);
    expect(putRes.status).toBe(200);
    expect(putRes.data.success).toBe(true);
    expect(putRes.data.branding.companyName).toBe("Acme Legal Process");
    expect(putRes.data.emailStatus.resendConfigured).toBe(true);

    // Verify GET retrieves updated settings
    const getRes = await admin.get("/api/org/settings");
    expect(getRes.data.branding.companyName).toBe("Acme Legal Process");
    expect(getRes.data.branding.contactPhone).toBe("555-999-0000");
    expect(getRes.data.branding.omitAffidavitFooter).toBe(true);
    expect(getRes.data.emailStatus.resendConfigured).toBe(true);
  });

  test("API Keys CRUD: generate, list, verify, and revoke", async () => {
    // 1. Generate via API
    const createRes = await admin.post("/api/org/api-keys", {
      name: "Zapier Integration",
      scopes: ["cases:read", "serves:write"],
    });
    expect(createRes.status).toBe(201);
    expect(createRes.data.success).toBe(true);
    expect(createRes.data.apiKey).toStartWith("st_live_");
    expect(createRes.data.keyRecord.name).toBe("Zapier Integration");

    const rawKey = createRes.data.apiKey;
    const keyId = createRes.data.keyRecord.id;

    // 2. Verify key validates
    const verified = verifyApiKey(db, rawKey);
    expect(verified).not.toBeNull();
    expect(verified?.id).toBe(keyId);

    // 3. List keys
    const listRes = await admin.get("/api/org/api-keys");
    expect(listRes.status).toBe(200);
    expect(listRes.data.keys.length).toBeGreaterThanOrEqual(1);
    const found = listRes.data.keys.find((k: any) => k.id === keyId);
    expect(found).toBeDefined();
    expect(found.revoked_at).toBeNull();

    // 4. Revoke key
    const deleteRes = await admin.del(`/api/org/api-keys/${keyId}`);
    expect(deleteRes.status).toBe(200);

    // 5. Verify revoked key no longer verifies
    const verifiedAfterRevoke = verifyApiKey(db, rawKey);
    expect(verifiedAfterRevoke).toBeNull();
  });
});

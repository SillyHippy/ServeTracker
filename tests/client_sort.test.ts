import { test, expect } from "bun:test";
import { Client, expectStatus } from "./helpers";

test("GET /api/clients sorts by most recent case, not alphabetically", async () => {
  const admin = new Client();
  const login = await admin.post("/api/auth/login", { password: "TestAdminPass123!" });
  expectStatus(login, 200, "admin login");

  const older = await admin.post("/api/clients", { name: "ZZ Older Firm" });
  expectStatus(older, 201, "older client");
  const campbell = await admin.post("/api/clients", { name: "Campbell Law Firm" });
  expectStatus(campbell, 201, "campbell client");
  const none = await admin.post("/api/clients", { name: "AAA No Cases Yet" });
  expectStatus(none, 201, "no-case client");

  const oldCase = await admin.post("/api/cases", {
    client_id: older.data.id,
    case_number: "OLD-SORT-1",
    case_name: "Older Job",
    defendant_respondent: "Old Defendant",
  });
  expectStatus(oldCase, 201, "older case");

  await Bun.sleep(25);

  const newCase = await admin.post("/api/cases", {
    client_id: campbell.data.id,
    case_number: "NEW-SORT-1",
    case_name: "Fresh Campbell Job",
    defendant_respondent: "New Defendant",
  });
  expectStatus(newCase, 201, "campbell case");

  const list = await admin.get("/api/clients");
  expectStatus(list, 200, "list clients");
  expect(Array.isArray(list.data)).toBe(true);

  const names = list.data.map((c: { name: string }) => c.name);
  const iCampbell = names.indexOf("Campbell Law Firm");
  const iOlder = names.indexOf("ZZ Older Firm");
  const iNone = names.indexOf("AAA No Cases Yet");

  expect(iCampbell).toBeGreaterThanOrEqual(0);
  expect(iOlder).toBeGreaterThanOrEqual(0);
  expect(iNone).toBeGreaterThanOrEqual(0);
  expect(iCampbell).toBeLessThan(iOlder);
  expect(iOlder).toBeLessThan(iNone);
});

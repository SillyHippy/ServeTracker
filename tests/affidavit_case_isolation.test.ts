import { test, expect, beforeAll } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "path";
import { Client, expectStatus, DATA_DIR } from "./helpers";

let admin: Client;
let clientId = "";

beforeAll(async () => {
  admin = new Client();
  const r = await admin.post("/api/auth/login", { password: "TestAdminPass123!" });
  expectStatus(r, 200, "admin login");
  const cl = await admin.post("/api/clients", { name: "Re-Serve Isolation Client" });
  expectStatus(cl, 201, "create client");
  clientId = cl.data.id;
});

test("re-serve of same case number does not inherit the prior job's attempts", async () => {
  const caseNumber = `FD-ISO-${Math.floor(Math.random() * 90000 + 10000)}`;

  const oldCase = await admin.post("/api/cases", {
    client_id: clientId,
    case_number: caseNumber,
    case_name: "Tina Isolation",
    defendant_respondent: "Tina Isolation",
    home_address: "822 W Fargo Dr, Broken Arrow, OK 74012",
    documents_to_serve: "Summons",
  });
  expectStatus(oldCase, 201, "create old case");

  const oldServe = await admin.post("/api/serves", {
    case_id: oldCase.data.id,
    case_number: caseNumber,
    person_being_served: "Tina Isolation",
    status: "completed",
    service_method: "personal",
    notes: "Successful personal service.",
    service_address: "822 W Fargo Dr, Broken Arrow, OK 74012",
    occurred_at: "2026-07-20T22:30:32.142Z",
    timestamp: "2026-07-20T22:30:32.142Z",
  });
  expectStatus(oldServe, 201, "log old attempt");

  const close = await admin.put(`/api/cases/${oldCase.data.id}`, { status: "closed" });
  expectStatus(close, 200, "close old case");

  const db = new Database(join(DATA_DIR, "pdfusaedit.db"));
  db.run(
    "UPDATE serve_attempts SET case_id = '', occurred_at = '2026-07-20T22:30:32.142Z', timestamp = '2026-07-20T22:30:32.142Z' WHERE id = ?",
    [oldServe.data.id]
  );
  db.close();

  const newCase = await admin.post("/api/cases", {
    client_id: clientId,
    case_number: caseNumber,
    case_name: "Tina Isolation",
    defendant_respondent: "Tina Isolation",
    home_address: "822 W Fargo Dr, Broken Arrow, OK 74012",
    documents_to_serve: "Summons; Petition for Dissolution of Marriage",
  });
  expectStatus(newCase, 201, "create new case");

  const newServe = await admin.post("/api/serves", {
    case_id: newCase.data.id,
    case_number: caseNumber,
    person_being_served: "Tina Isolation",
    status: "completed",
    service_method: "personal",
    notes: "Today's serve",
    service_address: "822 W Fargo Dr, Broken Arrow, OK 74012",
  });
  expectStatus(newServe, 201, "log new attempt");

  const aff = await admin.get(`/api/affidavit/${newCase.data.id}`);
  expectStatus(aff, 200, "affidavit for new case");
  const attempts = aff.data.attempts as { id: string; notes?: string }[];
  expect(attempts.length).toBe(1);
  expect(attempts[0].id).toBe(newServe.data.id);
  expect(String(attempts[0].notes || "")).not.toContain("Successful personal service");

  // Court numbers can be reused for a new job. It must start at Attempt 1
  // rather than inheriting numbering from the closed job.
  expect(newServe.data.attempt_number).toBe(1);
  const verifyDb = new Database(join(DATA_DIR, "pdfusaedit.db"), { readonly: true });
  const oldAttempt = verifyDb.query("SELECT attempt_number FROM serve_attempts WHERE id = ?").get(oldServe.data.id) as { attempt_number: number };
  verifyDb.close();
  expect(oldAttempt.attempt_number).toBe(1);

  const listed = await admin.get(`/api/serves?case_id=${newCase.data.id}`);
  expectStatus(listed, 200, "serves list for new case");
  const listedIds = (listed.data as { id: string }[]).map((r) => r.id);
  expect(listedIds).toEqual([newServe.data.id]);
});

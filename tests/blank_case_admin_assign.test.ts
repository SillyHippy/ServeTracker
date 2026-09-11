import { Database } from "bun:sqlite";
import { join } from "path";
import { beforeAll, expect, test } from "bun:test";
import { Client, DATA_DIR, expectStatus } from "./helpers";

const admin = new Client();
let clientId = "";

beforeAll(async () => {
  expectStatus(await admin.post("/api/auth/login", { password: "TestAdminPass123!" }), 200, "admin login");
  const cl = await admin.post("/api/clients", {
    name: "Blank Number Client",
    email: "blank-number@example.test",
  });
  expectStatus(cl, 201, "create client");
  clientId = cl.data.id;
});

test("new cases auto-assign to the creating admin", async () => {
  const cse = await admin.post("/api/cases", {
    client_id: clientId,
    case_number: `AUTO-${Date.now()}`,
    case_name: "Auto Assign Target",
    defendant_respondent: "Auto Assign Target",
    home_address: "1 Auto St, Tulsa, OK",
    documents_to_serve: "Notice",
  });
  expectStatus(cse, 201, "create auto-assign case");
  expect(cse.data.assigned_to).toBe("usr_admin_default");
  expect(String(cse.data.assigned_name || "")).toBeTruthy();
});

test("allow_unassigned keeps a case unassigned", async () => {
  const cse = await admin.post("/api/cases", {
    client_id: clientId,
    case_number: `UNAS-${Date.now()}`,
    case_name: "Stay Unassigned",
    defendant_respondent: "Stay Unassigned",
    home_address: "2 Auto St, Tulsa, OK",
    documents_to_serve: "Notice",
    allow_unassigned: true,
  });
  expectStatus(cse, 201, "create unassigned");
  expect(cse.data.assigned_to || "").toBe("");
});

test("blank case_number documents do not leak empty-filename ghosts", async () => {
  const cse = await admin.post("/api/cases", {
    client_id: clientId,
    case_number: "",
    case_name: "PRELIT TARGET",
    defendant_respondent: "PRELIT TARGET",
    home_address: "3 Auto St, Tulsa, OK",
    documents_to_serve: "Notice",
  });
  expectStatus(cse, 201, "create blank-number case");
  const caseId = cse.data.id;

  const db = new Database(join(DATA_DIR, "pdfusaedit.db"));
  db.run(
    `INSERT INTO client_documents (id, client_id, case_id, case_number, file_name, file_size, file_type, file_path, description, created_at)
     VALUES (?, ?, '', '', '', 0, 'application/pdf', '/tmp/ghost.pdf', 'ghost', datetime('now'))`,
    [`ghost_${Date.now()}`, clientId],
  );
  db.run(
    `INSERT INTO client_documents (id, client_id, case_id, case_number, file_name, file_size, file_type, file_path, description, created_at)
     VALUES (?, ?, ?, '', 'Notice.pdf', 1234, 'application/pdf', '/tmp/notice.pdf', 'real', datetime('now'))`,
    [`real_${Date.now()}`, clientId, caseId],
  );
  db.close();

  const listed = await admin.get(`/api/cases/${caseId}/documents`);
  expectStatus(listed, 200, "list docs");
  const docs = listed.data.documents || listed.data;
  const names = (Array.isArray(docs) ? docs : []).map((d: any) => String(d.fileName || d.file_name || ""));
  expect(names).toContain("Notice.pdf");
  expect(names.every((n: string) => n.trim() !== "")).toBe(true);
  expect(names.length).toBe(1);
});

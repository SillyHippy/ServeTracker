import { test, expect, beforeAll } from "bun:test";
import { Client, expectStatus } from "./helpers";

let admin: Client;
let clientId = "";

beforeAll(async () => {
  admin = new Client();
  const r = await admin.post("/api/auth/login", { password: "TestAdminPass123!" });
  expectStatus(r, 200, "admin login");
  const cl = await admin.post("/api/clients", { name: "Rename Client" });
  expectStatus(cl, 201, "create client");
  clientId = cl.data.id;
});

async function createNamedCase(name: string) {
  const created = await admin.post("/api/cases", {
    client_id: clientId,
    case_number: `RN-${Math.floor(Math.random() * 90000 + 10000)}`,
    case_name: name,
    defendant_respondent: name,
    home_address: "3445 E. 75th Pl., Tulsa, OK 74136-5975",
    documents_to_serve: "Summons; Complaint",
    recipients: [{ full_name: name, role: "defendant" }],
  });
  expectStatus(created, 201, "create case");
  const recs = await admin.get(`/api/recipients?case_id=${created.data.id}`);
  expectStatus(recs, 200, "list recipients");
  const list = Array.isArray(recs.data) ? recs.data : recs.data.recipients || [];
  expect(list.length).toBe(1);
  return { caseId: created.data.id as string, recipientId: String(list[0].id) };
}

test("renaming the only person by id updates that row and does not create a second person", async () => {
  const { caseId, recipientId } = await createNamedCase("RACHEL POSEY NFODJO, D.O.");
  const put = await admin.put(`/api/cases/${caseId}`, {
    case_name: "RACHEL POSEY, D.O.",
    defendant_respondent: "RACHEL POSEY, D.O.",
    recipients: [{ id: recipientId, full_name: "RACHEL POSEY, D.O.", role: "defendant" }],
  });
  expectStatus(put, 200, "rename by id");
  const recs = await admin.get(`/api/recipients?case_id=${caseId}`);
  const list = Array.isArray(recs.data) ? recs.data : recs.data.recipients || [];
  expect(list.length).toBe(1);
  expect(list[0].id).toBe(recipientId);
  expect(list[0].full_name).toBe("RACHEL POSEY, D.O.");
});

test("renaming the only person without sending id still updates instead of inserting", async () => {
  const { caseId, recipientId } = await createNamedCase("TEMPLE ZENONI, APRN");
  const put = await admin.put(`/api/cases/${caseId}`, {
    case_name: "TORY TEMPLE ZENONI, APRN",
    defendant_respondent: "TORY TEMPLE ZENONI, APRN",
    recipients: [{ full_name: "TORY TEMPLE ZENONI, APRN", role: "defendant" }],
  });
  expectStatus(put, 200, "rename without id");
  const recs = await admin.get(`/api/recipients?case_id=${caseId}`);
  const list = Array.isArray(recs.data) ? recs.data : recs.data.recipients || [];
  expect(list.length).toBe(1);
  expect(list[0].id).toBe(recipientId);
  expect(list[0].full_name).toBe("TORY TEMPLE ZENONI, APRN");
});

test("renaming via defendant_respondent only still updates the sole recipient", async () => {
  const { caseId, recipientId } = await createNamedCase("DEBORAH CRAWFORD, APRN");
  const put = await admin.put(`/api/cases/${caseId}`, {
    case_name: "DEBORAH CRAWFORD",
    defendant_respondent: "DEBORAH CRAWFORD",
  });
  expectStatus(put, 200, "rename via defendant only");
  const recs = await admin.get(`/api/recipients?case_id=${caseId}`);
  const list = Array.isArray(recs.data) ? recs.data : recs.data.recipients || [];
  expect(list.length).toBe(1);
  expect(list[0].id).toBe(recipientId);
  expect(list[0].full_name).toBe("DEBORAH CRAWFORD");
});

test("Add Person still creates a second recipient when a new name is added", async () => {
  const { caseId, recipientId } = await createNamedCase("JASON JOHN, M.D.");
  const put = await admin.put(`/api/cases/${caseId}`, {
    recipients: [
      { id: recipientId, full_name: "JASON JOHN, M.D.", role: "defendant" },
      { full_name: "DEBORAH CRAWFORD, APRN", role: "defendant" },
    ],
  });
  expectStatus(put, 200, "add second person");
  const recs = await admin.get(`/api/recipients?case_id=${caseId}`);
  const list = Array.isArray(recs.data) ? recs.data : recs.data.recipients || [];
  expect(list.length).toBe(2);
  expect(list.some((r: any) => r.id === recipientId && r.full_name === "JASON JOHN, M.D.")).toBe(true);
  expect(list.some((r: any) => r.id !== recipientId && r.full_name === "DEBORAH CRAWFORD, APRN")).toBe(true);
});

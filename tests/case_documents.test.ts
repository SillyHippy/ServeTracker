import { test, expect, beforeAll } from "bun:test";
import { Client, expectStatus } from "./helpers";
import { PDFDocument } from "pdf-lib";

let admin: Client;
let serverA: Client;
let serverB: Client;
let caseId: string;
let serverAId: string;
let serverBId: string;

beforeAll(async () => {
  admin = new Client();
  const r = await admin.post("/api/auth/login", { password: "TestAdminPass123!" });
  expectStatus(r, 200, "admin login");

  // Create Client
  const cliRes = await admin.post("/api/clients", {
    name: "Law Office of Test",
    email: "client@example.com",
  });
  expectStatus(cliRes, 201, "create client");
  const clientId = cliRes.data.id;

  // Create Server A
  serverA = new Client();
  const sARes = await serverA.post("/api/auth/register-server", {
    username: "server_a_" + Math.random().toString(36).slice(2, 8),
    password: "Password123!",
    displayName: "Server A",
    licenseNumber: "PSL-A-123",
    licenseJurisdiction: "Tulsa",
    licenseExpiresAt: "2028-12-31",
    serviceTerritory: ["Tulsa"],
    accepted_tos: true,
  });
  expectStatus(sARes, 201, "register server A");
  serverAId = sARes.data.user.id;

  // Create Server B
  serverB = new Client();
  const sBRes = await serverB.post("/api/auth/register-server", {
    username: "server_b_" + Math.random().toString(36).slice(2, 8),
    password: "Password123!",
    displayName: "Server B",
    licenseNumber: "PSL-B-123",
    licenseJurisdiction: "Tulsa",
    licenseExpiresAt: "2028-12-31",
    serviceTerritory: ["Tulsa"],
    accepted_tos: true,
  });
  expectStatus(sBRes, 201, "register server B");
  serverBId = sBRes.data.user.id;

  // Create Case
  const cRes = await admin.post("/api/cases", {
    clientId: clientId,
    client_id: clientId,
    case_number: "CV-2026-DOC-TEST",
    defendant_respondent: "Target Defendant",
    client_name: "Law Office of Test",
  });
  expectStatus(cRes, 201, "create case");
  caseId = cRes.data.id;

  // Assign Case to Server A
  const assignRes = await admin.post(`/api/admin/cases/${caseId}/assign`, { serverId: serverAId });
  expectStatus(assignRes, 200, "assign case to server A");
});

test("case document upload, role-gating, and static isolation", async () => {
  // 1. Create a dummy PDF using pdf-lib
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 400]);
  page.drawText("Summons & Petition Court Document", { x: 50, y: 350 });
  const pdfBytes = await pdfDoc.save();

  // 2. Admin uploads court document attached to the case
  const formData = new FormData();
  const file = new File([pdfBytes], "summons_and_petition.pdf", { type: "application/pdf" });
  formData.append("file", file);
  formData.append("description", "Summons & Petition");

  const uploadRes = await admin.post(`/api/cases/${caseId}/documents`, formData);
  expectStatus(uploadRes, 201, "upload court document");
  expect(uploadRes.data.fileName).toBe("summons_and_petition.pdf");
  const docId = uploadRes.data.id;

  // 3. Server A (Assigned) lists documents
  const listARes = await serverA.get(`/api/cases/${caseId}/documents`);
  expectStatus(listARes, 200, "server A list documents");
  expect(listARes.data.length).toBeGreaterThan(0);
  expect(listARes.data[0].id).toBe(docId);

  // 4. Server B (Not Assigned) lists documents -> 403 Forbidden
  const listBRes = await serverB.get(`/api/cases/${caseId}/documents`);
  expectStatus(listBRes, 403, "server B blocked from list");

  // 5. Server A downloads document stream -> 200 OK
  const downloadARes = await serverA.get(`/api/cases/${caseId}/documents/${docId}/download`);
  expectStatus(downloadARes, 200, "server A download");

  // 6. Server B downloads document stream -> 403 Forbidden
  const downloadBRes = await serverB.get(`/api/cases/${caseId}/documents/${docId}/download`);
  expectStatus(downloadBRes, 403, "server B blocked from download");

  // 7. Static isolation check: direct static access to /uploads/documents/... must be blocked
  const anon = new Client();
  const staticLeakRes = await anon.get(`/uploads/documents/${caseId}/${uploadRes.data.fileName}`);
  expectStatus(staticLeakRes, 403, "direct static document download blocked");

  // 8. Admin can delete the document
  const delRes = await admin.delete(`/api/cases/${caseId}/documents/${docId}`);
  expectStatus(delRes, 200, "admin delete document");
});

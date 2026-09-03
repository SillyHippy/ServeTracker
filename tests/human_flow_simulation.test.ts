import { test, expect } from "bun:test";
import { Client, expectStatus, dataUrl, TINY_PNG } from "./helpers";

test("Full End-to-End Human Flow: Multi-Recipient Case, Shared Attempts, E-Sign & Scoped Returns", async () => {
  const admin = new Client();

  // 1. Admin Login
  const loginRes = await admin.post("/api/auth/login", {
    password: "TestAdminPass123!",
  });
  expectStatus(loginRes, 200, "admin login");
  expect(loginRes.data.user.role).toBe("admin");

  // 2. Create Client (Law Firm)
  const clientRes = await admin.post("/api/clients", {
    name: "Stotts Legal Group PLLC",
    contact: "Julia Stotts, Esq.",
    email: "joseph@justlegalsolutions.org",
    phone: "918-555-0199",
    address: "100 E 2nd St, Tulsa, OK 74103",
  });
  expectStatus(clientRes, 201, "create client");
  const clientId = clientRes.data.id;

  // 3. Create Multi-Recipient Case with 2 distinct recipients:
  //    - Apex Logistics LLC (Business Entity)
  //    - Marcus Vance (Registered Agent / Individual)
  const caseRes = await admin.post("/api/cases", {
    client_id: clientId,
    case_name: "Julia Stotts v. Apex Logistics LLC & Marcus Vance",
    case_number: "SC-2026-99001",
    court_name: "District Court of Tulsa County",
    assigned_to: "usr_admin_default",
    assigned_name: "Admin User",
    person_being_served: "Apex Logistics LLC",
    service_address: "415 E 2nd St, Apt 2423, Tulsa, OK 74120",
    documents_to_serve: "Small Claims Affidavit and Order (Summons)",
    recipients: [
      {
        full_name: "Apex Logistics LLC",
        role: "Defendant / Corporate Entity",
        home_address: "415 E 2nd St, Apt 2423, Tulsa, OK 74120",
      },
      {
        full_name: "Marcus Vance",
        role: "Defendant / Registered Agent",
        home_address: "415 E 2nd St, Apt 2423, Tulsa, OK 74120",
      },
    ],
  });
  expectStatus(caseRes, 201, "create case");
  const caseId = caseRes.data.id;

  // Fetch created recipients with their assigned IDs
  const caseRecsRes = await admin.get(`/api/recipients?case_id=${caseId}`);
  expectStatus(caseRecsRes, 200, "get recipients");
  expect(caseRecsRes.data.length).toBe(2);
  const llcRec = caseRecsRes.data.find((r: any) => r.full_name.includes("Apex Logistics"));
  const indRec = caseRecsRes.data.find((r: any) => r.full_name.includes("Marcus Vance"));
  expect(llcRec).toBeTruthy();
  expect(indRec).toBeTruthy();

  // 4. Set Admin Server Profile License & Enroll Admin E-Signature Asset
  const updateProfileRes = await admin.put("/api/users/usr_admin_default", {
    displayName: "Joseph Iannazzi",
    legalName: "Joseph William Iannazzi",
    licenseNumber: "PSL-2026-TULSA",
    licenseJurisdiction: "OK",
    licenseExpiresAt: "2030-12-31",
  });
  expectStatus(updateProfileRes, 200, "update admin license");

  const enrollRes = await admin.post("/api/me/signature", {
    image_data: dataUrl(TINY_PNG),
    password: "TestAdminPass123!",
    ack: true,
  });
  expectStatus(enrollRes, 201, "enroll signature");

  // 5. Log Attempt 1: Failed visit at 12:54 PM (No answer at door)
  // Physical encounter that applies to the encounter
  const att1Res = await admin.post("/api/serves", {
    case_id: caseId,
    occurred_at: "2026-09-02T17:54:00.000Z",
    status: "failed",
    person_being_served: "Apex Logistics LLC & Marcus Vance",
    service_address: "415 E 2nd St, Apt 2423, Tulsa, OK 74120",
    notes: "Knocked multiple times. No answer at residence door.",
    gps_lat: 36.155,
    gps_lng: -95.991,
    accuracy: 5.2,
  });
  expectStatus(att1Res, 201, "log failed attempt");

  // 6. Log Attempt 2 (Shared Encounter at 1:06 PM):
  // Single physical stop resulting in 2 deliveries sharing the same event_id
  const sharedEventId = `evt_human_${Date.now()}_180600`;

  // 6A. Delivery to Corporate Entity (Apex Logistics LLC via Marcus Vance as Registered Agent)
  const att2CorporateRes = await admin.post("/api/serves", {
    case_id: caseId,
    recipient_id: llcRec.id,
    event_id: sharedEventId,
    occurred_at: "2026-09-02T18:06:00.000Z",
    status: "completed",
    person_being_served: "Apex Logistics LLC",
    service_method: "corporate",
    accepted_by: "Marcus Vance",
    recipient_title: "Registered Agent",
    entity_name: "Apex Logistics LLC",
    service_address: "415 E 2nd St, Apt 2423, Tulsa, OK 74120",
    notes: "Delivered corporate packet for Apex Logistics LLC to Marcus Vance as Registered Agent.",
    photos: [dataUrl(TINY_PNG)],
    gps_lat: 36.155,
    gps_lng: -95.991,
    accuracy: 4.8,
  });
  expectStatus(att2CorporateRes, 201, "log corporate serve");

  // 6B. Delivery to Individual (Marcus Vance personally)
  const att2PersonalRes = await admin.post("/api/serves", {
    case_id: caseId,
    recipient_id: indRec.id,
    event_id: sharedEventId,
    occurred_at: "2026-09-02T18:06:01.000Z",
    status: "completed",
    person_being_served: "Marcus Vance",
    service_method: "personal",
    service_address: "415 E 2nd St, Apt 2423, Tulsa, OK 74120",
    notes: "Delivered individual packet to Marcus Vance personally.",
    photos: [dataUrl(TINY_PNG)],
    gps_lat: 36.155,
    gps_lng: -95.991,
    accuracy: 4.8,
  });
  expectStatus(att2PersonalRes, 201, "log personal serve");

  // 7. Verify Multi-Recipient Guard on Prepare
  // Missing recipientId must return 400 on multi-recipient cases
  const prepBadRes = await admin.post("/api/affidavits/prepare", { caseId });
  expect(prepBadRes.status).toBe(400);

  // 8. Prepare Corporate Recipient (Apex Logistics LLC)
  const prepLlcRes = await admin.post("/api/affidavits/prepare", {
    caseId,
    recipientId: llcRec.id,
  });
  expectStatus(prepLlcRes, 200, "prepare corporate affidavit");
  expect(prepLlcRes.data.ready).toBe(true);
  expect(prepLlcRes.data.preview.kind).toBe("service");
  expect(prepLlcRes.data.preview.title).toBe("AFFIDAVIT OF SERVICE");
  expect(prepLlcRes.data.preview.personServed).toContain("Apex Logistics LLC");
  expect(prepLlcRes.data.preview.method).toBe("corporate");

  // 9. Prepare Individual Recipient (Marcus Vance)
  const prepIndRes = await admin.post("/api/affidavits/prepare", {
    caseId,
    recipientId: indRec.id,
  });
  expectStatus(prepIndRes, 200, "prepare individual affidavit");
  expect(prepIndRes.data.ready).toBe(true);
  expect(prepIndRes.data.preview.kind).toBe("service");
  expect(prepIndRes.data.preview.title).toBe("AFFIDAVIT OF SERVICE");
  expect(prepIndRes.data.preview.personServed).toContain("Marcus Vance");
  expect(prepIndRes.data.preview.method).toBe("personal");

  // 10. E-Sign Corporate Recipient (Apex Logistics LLC)
  const signLlcRes = await admin.post(`/api/affidavits/${caseId}/sign`, {
    recipientId: llcRec.id,
    password: "TestAdminPass123!",
    swornCounty: "Tulsa",
    swornState: "Oklahoma",
  });
  expectStatus(signLlcRes, 201, "sign corporate affidavit");
  expect(signLlcRes.data.execution.status).toBe("signed_not_notarized");
  const llcExecutionId = signLlcRes.data.execution.id;
  expect(llcExecutionId).toBeTruthy();

  // 11. E-Sign Individual Recipient (Marcus Vance)
  const signIndRes = await admin.post(`/api/affidavits/${caseId}/sign`, {
    recipientId: indRec.id,
    password: "TestAdminPass123!",
    swornCounty: "Tulsa",
    swornState: "Oklahoma",
  });
  expectStatus(signIndRes, 201, "sign individual affidavit");
  expect(signIndRes.data.execution.status).toBe("signed_not_notarized");
  const indExecutionId = signIndRes.data.execution.id;
  expect(indExecutionId).toBeTruthy();
  expect(indExecutionId).not.toBe(llcExecutionId);

  // 12. Render Corporate Signed Return HTML
  const renderLlcRes = await admin.get(`/api/affidavits/${caseId}/render?recipientId=${llcRec.id}`);
  expectStatus(renderLlcRes, 200, "render corporate affidavit");
  const renderLlcHtml = String(renderLlcRes.data.html);

  // Assert Corporate Return Compliance:
  expect(renderLlcHtml).toContain("AFFIDAVIT OF SERVICE");
  expect(renderLlcHtml).toContain("Apex Logistics LLC");
  expect(renderLlcHtml).toContain("Registered Agent");
  expect(renderLlcHtml).toContain("service of process upon <strong>Apex Logistics LLC</strong>");
  expect(renderLlcHtml).toContain("to <strong>Marcus Vance</strong>, the <strong>Registered Agent</strong>");
  expect(renderLlcHtml).not.toContain("I executed personal service upon Apex Logistics LLC");

  // 13. Render Individual Signed Return HTML
  const renderIndRes = await admin.get(`/api/affidavits/${caseId}/render?recipientId=${indRec.id}`);
  expectStatus(renderIndRes, 200, "render individual affidavit");
  const renderIndHtml = String(renderIndRes.data.html);

  // Assert Individual Return Compliance:
  expect(renderIndHtml).toContain("AFFIDAVIT OF SERVICE");
  expect(renderIndHtml).toContain("Marcus Vance");
  expect(renderIndHtml).toContain("I executed personal service upon");
  expect(renderIndHtml).not.toContain("Registered Agent authorized to accept service on behalf of");

  // 14. Assert Physical Attempt Chronology Grouping:
  // Both returns must contain both timestamps (12:54 PM and 1:06 PM)
  expect(renderLlcHtml).toContain("12:54");
  expect(renderLlcHtml).toContain("1:06");
  expect(renderIndHtml).toContain("12:54");
  expect(renderIndHtml).toContain("1:06");

  console.log("✓ All 14 steps of human flow verification passed 100% cleanly.");
});

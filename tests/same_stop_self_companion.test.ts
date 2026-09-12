import { test, expect, beforeAll } from "bun:test";
import { Client, expectStatus } from "./helpers";
import { buildStopDeliveriesFromForm, newEncounterEventId } from "../src/utils/serveAttemptForm";

const admin = new Client();
let clientId = "";

beforeAll(async () => {
  expectStatus(
    await admin.post("/api/auth/login", { password: "TestAdminPass123!" }),
    200,
    "admin login"
  );
  const cl = await admin.post("/api/clients", {
    name: "Same-Stop Mock Firm",
    contact: "Mock Intake",
    email: "same-stop-mock@example.test",
    phone: "555-0100",
    address: "1 Mock St, Tulsa, OK 74105",
  });
  expectStatus(cl, 201, "create mock client");
  clientId = cl.data.client?.id || cl.data.id;
  expect(clientId).toBeTruthy();
});

test("1-person DBA save posts one delivery even when Defendant was selected", async () => {
  const cse = await admin.post("/api/cases", {
    client_id: clientId,
    case_number: "SC-2026-MOCK-JODY",
    case_name: "Mock v Jody DBA",
    defendant_respondent: "JODY BESON DBA CLEAN MACHINE AUTO DETAIL",
    home_address: "4644 S Troost Ave, Tulsa, OK 74105",
    documents_to_serve: "Small Claims Affidavit and Order",
    assigned_to: "usr_admin_default",
    recipients: [{ full_name: "JODY BESON DBA CLEAN MACHINE AUTO DETAIL", role: "Defendant" }],
  });
  expectStatus(cse, 201, "create 1-person DBA case");
  const caseId = cse.data.case?.id || cse.data.id;
  const recs = await admin.get(`/api/recipients?case_id=${caseId}`);
  expectStatus(recs, 200, "list recipients");
  expect(recs.data.length).toBe(1);

  const deliveries = buildStopDeliveriesFromForm({
    status: "completed",
    selectedRecipientId: "",
    recipients: recs.data,
    pbsName: "JODY BESON DBA CLEAN MACHINE AUTO DETAIL",
    serviceMethod: "personal",
  });
  expect(deliveries).toHaveLength(1);

  const eventId = newEncounterEventId();
  const occurredAt = "2026-09-12T13:00:00.000Z";
  for (const delivery of deliveries) {
    const posted = await admin.post("/api/serves", {
      case_id: caseId,
      case_number: "SC-2026-MOCK-JODY",
      recipient_id: delivery.recipientId === "default_pbs" ? "" : delivery.recipientId,
      person_being_served: delivery.personName,
      event_id: eventId,
      status: "completed",
      service_method: delivery.serviceMethod,
      accepted_by: delivery.acceptedBy,
      notes: "mock 1-person DBA personal — do not email",
      sendEmail: false,
      isTest: true,
      occurred_at: occurredAt,
      timestamp: occurredAt,
    });
    expectStatus(posted, 201, "post 1-person delivery");
  }

  const listed = await admin.get(`/api/serves?case_id=${caseId}`);
  expectStatus(listed, 200, "list 1-person serves");
  const rows = (listed.data || []).filter((s: any) => String(s.event_id || s.eventId) === eventId);
  expect(rows.length).toBe(1);
  expect(String(rows[0].recipient_id || rows[0].recipientId)).toBe(recs.data[0].id);
});

test("3-person house: Personal + Personal + Substitute shares one event_id", async () => {
  const cse = await admin.post("/api/cases", {
    client_id: clientId,
    case_number: "SC-2026-MOCK-HOUSE3",
    case_name: "Mock v Three at House",
    defendant_respondent: "John Doe 1",
    home_address: "3333 E 77th Street, Tulsa, OK 74136",
    documents_to_serve: "Summons",
    assigned_to: "usr_admin_default",
    recipients: [
      { full_name: "John Doe 1", role: "Defendant" },
      { full_name: "Jane Doe 1", role: "Defendant" },
      { full_name: "John Doe 3", role: "Defendant" },
    ],
  });
  expectStatus(cse, 201, "create 3-person case");
  const caseId = cse.data.case?.id || cse.data.id;
  const recs = await admin.get(`/api/recipients?case_id=${caseId}`);
  expectStatus(recs, 200, "list 3 recipients");
  expect(recs.data.length).toBe(3);
  const john = recs.data.find((r: any) => r.full_name === "John Doe 1");
  const jane = recs.data.find((r: any) => r.full_name === "Jane Doe 1");
  const john3 = recs.data.find((r: any) => r.full_name === "John Doe 3");

  const deliveries = buildStopDeliveriesFromForm({
    status: "completed",
    selectedRecipientId: john.id,
    recipients: recs.data,
    pbsName: "John Doe 1",
    serviceMethod: "personal",
    companionMethods: {
      [jane.id]: "personal",
      [john3.id]: "substituted-residence",
    },
  });
  expect(deliveries).toHaveLength(3);

  const eventId = newEncounterEventId();
  const occurredAt = "2026-09-12T13:05:00.000Z";
  for (const delivery of deliveries) {
    const posted = await admin.post("/api/serves", {
      case_id: caseId,
      case_number: "SC-2026-MOCK-HOUSE3",
      recipient_id: delivery.recipientId,
      person_being_served: delivery.personName,
      event_id: eventId,
      status: "completed",
      service_method: delivery.serviceMethod,
      accepted_by: delivery.acceptedBy,
      notes: "mock 3-person same-stop — do not email",
      sendEmail: false,
      isTest: true,
      occurred_at: occurredAt,
      timestamp: occurredAt,
    });
    expectStatus(posted, 201, `post ${delivery.personName}`);
  }

  const listed = await admin.get(`/api/serves?case_id=${caseId}`);
  const rows = (listed.data || []).filter((s: any) => String(s.event_id || s.eventId) === eventId);
  expect(rows.length).toBe(3);
  expect(new Set(rows.map((s: any) => s.recipient_id || s.recipientId)).size).toBe(3);
  const sub = rows.find((s: any) => (s.person_being_served || s.personBeingServed) === "John Doe 3");
  expect(String(sub.service_method || sub.serviceMethod)).toBe("substituted-residence");
  expect(String(sub.accepted_by || sub.acceptedBy)).toBe("John Doe 1");
});

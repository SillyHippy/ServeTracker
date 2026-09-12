import { expect, test, beforeAll } from "bun:test";
import { Client, expectStatus } from "./helpers";
import { buildStopDeliveriesFromForm, newEncounterEventId } from "../src/utils/serveAttemptForm";

const admin = new Client();
let clientId = "";

beforeAll(async () => {
  expectStatus(
    await admin.post("/api/auth/login", {
      username: "admin",
      password: process.env.APP_PASSWORD || "TestAdminPass123!",
    }),
    200,
    "admin login"
  );
  const cl = await admin.post("/api/clients", {
    name: "PS Only Mock Firm",
    email: "ps-only-mock@example.test",
    phone: "555-0144",
  });
  expectStatus(cl, 201, "create client");
  clientId = cl.data.client?.id || cl.data.id;
  expect(clientId).toBeTruthy();
});

test("intake flag persists and substitute POST is rejected", async () => {
  const cse = await admin.post("/api/cases", {
    client_id: clientId,
    case_number: "PG-2026-MOCK-PSFLAG",
    case_name: "Toni Mock",
    defendant_respondent: "Toni Mock & Steven Mock",
    home_address: "100 Mock PG St, Tulsa, OK 74112",
    documents_to_serve: "Petition for Guardianship",
    assigned_to: "usr_admin_default",
    recipients: [
      { full_name: "Toni Mock", role: "Relative", personal_service_only: false },
      { full_name: "Steven Mock", role: "Proposed Ward", personal_service_only: true },
    ],
  });
  expectStatus(cse, 201, "create PG mock case");
  const caseId = cse.data.case?.id || cse.data.id;
  const recs = await admin.get(`/api/recipients?case_id=${caseId}`);
  expectStatus(recs, 200, "list recipients");
  expect(recs.data.length).toBe(2);
  const toni = recs.data.find((r: { full_name: string }) => r.full_name === "Toni Mock");
  const steven = recs.data.find((r: { full_name: string }) => r.full_name === "Steven Mock");
  expect(toni.personal_service_only).toBe(false);
  expect(steven.personal_service_only).toBe(true);

  const blocked = await admin.post("/api/serves", {
    case_id: caseId,
    case_number: "PG-2026-MOCK-PSFLAG",
    recipient_id: steven.id,
    person_being_served: "Steven Mock",
    status: "completed",
    service_method: "substituted-residence",
    accepted_by: "Toni Mock",
    sendEmail: false,
    isTest: true,
  });
  expectStatus(blocked, 400, "reject substitute on PS-only person");

  const eventId = newEncounterEventId();
  const deliveries = buildStopDeliveriesFromForm({
    status: "completed",
    selectedRecipientId: toni.id,
    recipients: recs.data,
    pbsName: "Toni Mock",
    serviceMethod: "personal",
  });
  expect(deliveries).toHaveLength(2);
  expect(deliveries.find((d) => d.recipientId === steven.id)?.status).toBe("failed");

  for (const delivery of deliveries) {
    const posted = await admin.post("/api/serves", {
      case_id: caseId,
      case_number: "PG-2026-MOCK-PSFLAG",
      recipient_id: delivery.recipientId,
      person_being_served: delivery.personName,
      event_id: eventId,
      status: delivery.status || "completed",
      service_method: delivery.status === "failed" ? "" : delivery.serviceMethod,
      accepted_by: delivery.acceptedBy,
      notes: delivery.notes || "mock mixed stop",
      sendEmail: false,
      isTest: true,
    });
    expectStatus(posted, 201, `post ${delivery.personName}`);
  }

  const listed = await admin.get(`/api/serves?case_id=${caseId}`);
  expectStatus(listed, 200, "list serves");
  const rows = (listed.data || []).filter((s: { event_id?: string; eventId?: string }) =>
    String(s.event_id || s.eventId) === eventId
  );
  expect(rows.length).toBe(2);
  const stevenRow = rows.find((s: { recipient_id?: string; recipientId?: string }) =>
    String(s.recipient_id || s.recipientId) === steven.id
  );
  expect(String(stevenRow.status)).toBe("failed");

  const got = await admin.get(`/api/cases/${caseId}`);
  expectStatus(got, 200, "GET case");
  expect(String(got.data.status || "").toLowerCase()).not.toBe("served");

  const queue = await admin.get("/api/affidavits/queue");
  expectStatus(queue, 200, "sign queue");
  const items = (queue.data.queue || []).filter((q: { caseId?: string }) => q.caseId === caseId);
  expect(items.map((q: { recipientId: string }) => q.recipientId)).toEqual([toni.id]);
});

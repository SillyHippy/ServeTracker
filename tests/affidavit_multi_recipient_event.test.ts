import { test, expect, beforeAll } from "bun:test";
import {
  generateAffidavitHtml,
  latestSuccessfulServe,
  physicalAttemptsForAffidavit,
  type AffidavitPayload,
} from "../src/utils/affidavitEngine";
import type { ServeAttemptData } from "../src/types/ServeAttemptData";
import { Client, expectStatus, TINY_PNG, dataUrl } from "./helpers";

/**
 * SC-2026-10190. One physical encounter served Rebecca Radam Collins in her
 * personal capacity AND Collins Properties LLC through her as registered
 * agent. The two deliveries are separate legal facts recorded as sibling rows
 * of one event.
 */
const PERSON_REC = "rec_collins_person";
const LLC_REC = "rec_collins_llc";
const PERSON_NAME = "Rebecca Radam Collins";
const LLC_NAME = "Collins Properties LLC";
const ENCOUNTER = "evt_collins_stop_1";
const ENCOUNTER_AT = "2026-08-28T18:05:00.000Z";

function att(extra: Record<string, unknown>): ServeAttemptData {
  return {
    client_id: "c1",
    case_name: "Collins",
    case_number: "SC-2026-10190",
    status: "failed",
    attempt_type: "physical",
    ...extra,
  } as ServeAttemptData;
}

const personalRow = att({
  id: "srv_person",
  event_id: ENCOUNTER,
  recipient_id: PERSON_REC,
  person_being_served: PERSON_NAME,
  status: "completed",
  service_method: "personal",
  occurred_at: ENCOUNTER_AT,
  notes: "Served individually.",
  photos: [{ id: "p1", position: 1, imageUrl: "/uploads/serves/a.jpg", image_url: "/uploads/serves/a.jpg" }],
});

const corporateRow = att({
  id: "srv_llc",
  event_id: ENCOUNTER,
  recipient_id: LLC_REC,
  person_being_served: LLC_NAME,
  status: "completed",
  service_method: "corporate",
  accepted_by: PERSON_NAME,
  entity_name: LLC_NAME,
  recipient_title: "Registered Agent",
  occurred_at: ENCOUNTER_AT,
  notes: "Served as registered agent.",
  photos: [{ id: "p2", position: 1, imageUrl: "/uploads/serves/b.jpg", image_url: "/uploads/serves/b.jpg" }],
});

function payloadFor(recipient: { id: string; full_name: string }, attempts: ServeAttemptData[]) {
  return {
    case: {
      case_number: "SC-2026-10190",
      case_name: "Collins",
      documents_to_serve: "Summons and Petition",
    },
    recipient,
    attempts,
    swornDate: new Date("2026-08-29T12:00:00.000Z"),
  } as AffidavitPayload;
}

// ---------------------------------------------------------------- engine ---

test("each recipient resolves its own method from the same encounter", () => {
  const attempts = [personalRow, corporateRow];
  const llc = latestSuccessfulServe(attempts, LLC_REC, LLC_NAME) as ServeAttemptData;
  const person = latestSuccessfulServe(attempts, PERSON_REC, PERSON_NAME) as ServeAttemptData;
  expect(llc.service_method).toBe("corporate");
  expect(person.service_method).toBe("personal");
});

test("LLC affidavit swears corporate service, never the agent's personal delivery", () => {
  const html = generateAffidavitHtml(payloadFor({ id: LLC_REC, full_name: LLC_NAME }, [personalRow, corporateRow]));
  expect(html).toContain(`service of process upon <strong>${LLC_NAME}</strong>`);
  expect(html).toContain("Registered Agent");
  expect(html).not.toContain("I executed personal service");
});

test("a recipient with no completed attempt prints METHOD NOT RECORDED", () => {
  // Only the individual was recorded — the LLC row was never captured.
  const attempts = [personalRow, att({ id: "srv_llc_miss", event_id: ENCOUNTER, recipient_id: LLC_REC, person_being_served: LLC_NAME, status: "failed", occurred_at: ENCOUNTER_AT })];
  expect(latestSuccessfulServe(attempts, LLC_REC, LLC_NAME)).toBeNull();

  // If affidavitKind is explicitly forced to 'service' but no completed attempt exists for target
  const html = generateAffidavitHtml({
    ...payloadFor({ id: LLC_REC, full_name: LLC_NAME }, attempts),
    affidavitKind: "service",
  });
  expect(html).toContain("METHOD OF SERVICE NOT RECORDED");
  expect(html).not.toContain("I executed personal service");
});

test("two deliveries at one stop collapse to a single attempt bar, keeping both photos", () => {
  const attempts = [personalRow, corporateRow];
  expect(physicalAttemptsForAffidavit(attempts).length).toBe(1);

  const html = generateAffidavitHtml(payloadFor({ id: LLC_REC, full_name: LLC_NAME }, attempts));
  expect(html).toContain("Attempt 1");
  expect(html).not.toContain("Attempt 2");
  expect(html).toContain("EXHIBIT PHOTOS (2)");
  expect(html).toContain("Served as registered agent.");
});

test("separate encounters still print as separate attempts", () => {
  const later = att({
    id: "srv_later",
    event_id: "evt_collins_stop_2",
    recipient_id: LLC_REC,
    person_being_served: LLC_NAME,
    status: "failed",
    occurred_at: "2026-08-30T14:00:00.000Z",
  });
  expect(physicalAttemptsForAffidavit([personalRow, corporateRow, later]).length).toBe(2);
});

test("legacy rows without recipient attribution keep the global fallback", () => {
  const legacy = [att({ id: "old", status: "completed", service_method: "personal", occurred_at: ENCOUNTER_AT })];
  const found = latestSuccessfulServe(legacy, "rec_unknown", "Nobody By That Name") as ServeAttemptData;
  expect(found.service_method).toBe("personal");
});

// ------------------------------------------------------------------ api ---

let admin: Client;
let field: Client;
let fieldId = "";
let caseId = "";
let caseNumber = "";
let personRecId = "";
let llcRecId = "";

const F_USER = "sc10190_server";
const F_INIT = "Sc10190Init1!";
const F_PASS = "Sc10190Next1!";

beforeAll(async () => {
  admin = new Client();
  expectStatus(await admin.post("/api/auth/login", { password: "TestAdminPass123!" }), 200, "admin login");

  const cl = await admin.post("/api/clients", { name: "Collins Matter Client" });
  expectStatus(cl, 201, "create client");

  const usr = await admin.post("/api/users", {
    username: F_USER,
    password: F_INIT,
    displayName: "SC10190 Server",
    legalName: "SC10190 Server Legal",
    licenseNumber: "PSL-SC10190",
    licenseJurisdiction: "OK",
    licenseExpiresAt: "2030-12-31",
  });
  expectStatus(usr, 201, "create field server");
  fieldId = usr.data.user.id;
  expectStatus(await admin.put(`/api/users/${fieldId}`, { onboardingStatus: "active" }), 200, "onboard");

  field = new Client();
  expectStatus(await field.post("/api/auth/login", { username: F_USER, password: F_INIT }), 200, "field login");
  expectStatus(
    await field.post("/api/me/change-password", { currentPassword: F_INIT, newPassword: F_PASS }),
    200,
    "unlock"
  );
  expectStatus(
    await field.post("/api/me/signature", { password: F_PASS, image_data: dataUrl(TINY_PNG), mime_type: "image/png", ack: true }),
    201,
    "enroll signature"
  );

  caseNumber = `SC-2026-${Math.floor(Math.random() * 90000 + 10000)}`;
  const cse = await admin.post("/api/cases", {
    client_id: cl.data.id,
    case_number: caseNumber,
    case_name: `${PERSON_NAME} and ${LLC_NAME}`,
    defendant_respondent: LLC_NAME,
    home_address: "1200 S Detroit Ave, Tulsa, OK 74120",
    documents_to_serve: "Summons; Petition",
    assigned_to: fieldId,
    recipients: [
      { full_name: PERSON_NAME, role: "Defendant / Respondent" },
      { full_name: LLC_NAME, role: "Registered Agent Service" },
    ],
  });
  expectStatus(cse, 201, "create multi-recipient case");
  caseId = cse.data.id;

  const recs = await admin.get(`/api/recipients?case_id=${caseId}`);
  expectStatus(recs, 200, "list recipients");
  personRecId = recs.data.find((r: any) => r.full_name === PERSON_NAME).id;
  llcRecId = recs.data.find((r: any) => r.full_name === LLC_NAME).id;
  expect(personRecId).toBeTruthy();
  expect(llcRecId).toBeTruthy();
});

test("prepare refuses to guess the recipient on a multi-recipient case", async () => {
  const r = await admin.post("/api/affidavits/prepare", { caseId });
  expectStatus(r, 400, "prepare without recipientId");
  expect(r.data.recipientRequired).toBe(true);
  expect(r.data.recipients.length).toBe(2);
});

test("sign refuses to guess the recipient on a multi-recipient case", async () => {
  const r = await admin.post(`/api/affidavits/${caseId}/sign`, { acknowledged: true });
  expectStatus(r, 400, "sign without recipientId");
  expect(r.data.recipientRequired).toBe(true);
});

test("a recipient from another case is rejected", async () => {
  const r = await admin.post("/api/affidavits/prepare", { caseId, recipientId: "rec_not_on_this_case" });
  expectStatus(r, 404, "foreign recipient rejected");
});

test("dual delivery at one stop stores two rows under one event_id", async () => {
  const eventId = `evt_${Date.now()}`;
  const occurredAt = "2026-08-28T18:05:00.000Z";

  const personServe = await field.post("/api/serves", {
    case_id: caseId,
    case_number: caseNumber,
    recipient_id: personRecId,
    person_being_served: PERSON_NAME,
    event_id: eventId,
    status: "completed",
    service_method: "personal",
    notes: "Served individually at the residence.",
    service_address: "1200 S Detroit Ave, Tulsa, OK 74120",
    occurred_at: occurredAt,
    timestamp: occurredAt,
  });
  expectStatus(personServe, 201, "log personal serve");

  const llcServe = await field.post("/api/serves", {
    case_id: caseId,
    case_number: caseNumber,
    recipient_id: llcRecId,
    person_being_served: LLC_NAME,
    event_id: eventId,
    status: "completed",
    service_method: "corporate",
    accepted_by: PERSON_NAME,
    entity_name: LLC_NAME,
    recipient_title: "Registered Agent",
    notes: "Served as registered agent at the same stop.",
    service_address: "1200 S Detroit Ave, Tulsa, OK 74120",
    occurred_at: occurredAt,
    timestamp: occurredAt,
  });
  expectStatus(llcServe, 201, "log corporate serve");

  const listed = await admin.get(`/api/serves?case_id=${caseId}`);
  expectStatus(listed, 200, "list serves");
  const rows = listed.data.filter((s: any) => s.event_id === eventId);
  expect(rows.length).toBe(2);
  expect(new Set(rows.map((s: any) => s.recipient_id)).size).toBe(2);
});

test("prepare is scoped per recipient: personal for the individual, corporate for the LLC", async () => {
  const person = await admin.post("/api/affidavits/prepare", { caseId, recipientId: personRecId });
  expectStatus(person, 200, "prepare individual");
  expect(person.data.preview.personServed).toBe(PERSON_NAME);
  expect(person.data.preview.method).toBe("personal");
  expect(person.data.preview.methodRecorded).toBe(true);

  const llc = await admin.post("/api/affidavits/prepare", { caseId, recipientId: llcRecId });
  expectStatus(llc, 200, "prepare LLC");
  expect(llc.data.preview.personServed).toBe(LLC_NAME);
  expect(llc.data.preview.method).toBe("corporate");
  expect(llc.data.preview.methodRecorded).toBe(true);
});

test("signing the LLC leaves the individual unsigned — no cross-recipient leak", async () => {
  const signLlc = await admin.post(`/api/affidavits/${caseId}/sign`, { recipientId: llcRecId, acknowledged: true });
  expectStatus(signLlc, 201, "sign LLC");

  const llcRender = await admin.get(`/api/affidavits/${caseId}/render?recipientId=${llcRecId}`);
  expectStatus(llcRender, 200, "render LLC");
  expect(llcRender.data.html).toContain(`service of process upon <strong>${LLC_NAME}</strong>`);
  expect(llcRender.data.html).not.toContain("I executed personal service");

  // The individual was never signed. It must 409, not hand back the LLC's affidavit.
  const personRender = await admin.get(`/api/affidavits/${caseId}/render?recipientId=${personRecId}`);
  expectStatus(personRender, 409, "individual not signed yet");
  expect(personRender.data.status).toBe("none");

  const personPrep = await admin.post("/api/affidavits/prepare", { caseId, recipientId: personRecId });
  expect(personPrep.data.executionStatus).toBe("none");
});

test("both recipients hold independent signed affidavits at the same time", async () => {
  const signPerson = await admin.post(`/api/affidavits/${caseId}/sign`, { recipientId: personRecId, acknowledged: true });
  expectStatus(signPerson, 201, "sign individual");
  // A different recipient's affidavit is not a prior version of this one.
  expect(signPerson.data.execution.supersedesExecutionId).toBeFalsy();

  const personRender = await admin.get(`/api/affidavits/${caseId}/render?recipientId=${personRecId}`);
  expectStatus(personRender, 200, "render individual");
  expect(personRender.data.html).toContain("I executed personal service");

  const llcRender = await admin.get(`/api/affidavits/${caseId}/render?recipientId=${llcRecId}`);
  expectStatus(llcRender, 200, "LLC still signed");
  expect(llcRender.data.html).toContain(`service of process upon <strong>${LLC_NAME}</strong>`);

  // One physical encounter — the chronology must not claim two attempts.
  expect(llcRender.data.html).toContain("Attempt 1");
  expect(llcRender.data.html).not.toContain("Attempt 2");
});

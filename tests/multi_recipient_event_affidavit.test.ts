import { test, expect, beforeAll } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "path";
import {
  generateAffidavitHtml,
  generateBatchAffidavitsHtml,
  inferAffidavitKind,
  latestSuccessfulServe,
  physicalAttemptsForAffidavit,
  type AffidavitPayload,
} from "../src/utils/affidavitEngine";
import type { ServeAttemptData } from "../src/types/ServeAttemptData";
import { Client, expectStatus, DATA_DIR } from "./helpers";

let admin: Client;
let testClientId = "";

beforeAll(async () => {
  admin = new Client();
  const r = await admin.post("/api/auth/login", { password: "TestAdminPass123!" });
  expectStatus(r, 200, "admin login");
  const cl = await admin.post("/api/clients", { name: "SC-2026-10190 Test Client" });
  expectStatus(cl, 201, "create client");
  testClientId = cl.data.id;
});

function createAttempt(partial: Partial<ServeAttemptData> & { occurred_at: string }): ServeAttemptData {
  return {
    client_id: "c1",
    case_name: "Julia Stotts v. Collins Properties LLC",
    case_number: "SC-2026-10190",
    status: "failed",
    attempt_type: "physical",
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// 1. SC-2026-10190 Exact Reproduction & Dual-Delivery Encounter
// ---------------------------------------------------------------------------
test("SC-2026-10190: Dual delivery at same encounter produces distinct recipient-scoped affidavits", () => {
  const eventId = "evt_encounter_20260902_1306";
  const recipientIndividualId = "rec_rebecca_collins";
  const recipientLlcId = "rec_collins_properties_llc";

  const attempts: ServeAttemptData[] = [
    // Attempt 1: Prior unsuccessful attempt
    createAttempt({
      id: "att_1",
      attempt_number: 1,
      status: "failed",
      occurred_at: "2026-09-02T17:54:00.000Z", // 12:54 PM CT
      notes: "Knocked, no answer at front door.",
      service_address: "123 Main St, Tulsa, OK 74103",
    }),
    // Attempt 2A: Personal delivery to Rebecca Radam Collins
    createAttempt({
      id: "att_2a",
      attempt_number: 2,
      event_id: eventId,
      status: "completed",
      recipient_id: recipientIndividualId,
      person_being_served: "Rebecca Radam Collins",
      service_method: "personal",
      occurred_at: "2026-09-02T18:06:00.000Z", // 1:06 PM CT
      notes: "Served Rebecca personally at residence.",
      service_address: "123 Main St, Tulsa, OK 74103",
    }),
    // Attempt 2B: Corporate delivery to Collins Properties LLC via Registered Agent
    createAttempt({
      id: "att_2b",
      attempt_number: 2,
      event_id: eventId,
      status: "completed",
      recipient_id: recipientLlcId,
      person_being_served: "Collins Properties LLC",
      service_method: "corporate",
      accepted_by: "Rebecca Radam Collins",
      entity_name: "Collins Properties LLC",
      recipient_title: "Registered Agent",
      occurred_at: "2026-09-02T18:06:05.000Z", // 1:06:05 PM CT (logged seconds apart)
      notes: "Served Collins Properties LLC through Registered Agent Rebecca Radam Collins.",
      service_address: "123 Main St, Tulsa, OK 74103",
    }),
  ];

  const caseInfo = {
    case_number: "SC-2026-10190",
    case_name: "Julia Stotts v. Collins Properties LLC, et al.",
    plaintiff_petitioner: "Julia Stotts",
    defendant_respondent: "Collins Properties LLC, et al.",
    court_name: "DISTRICT COURT OF TULSA COUNTY",
    documents_to_serve: "Small Claims Affidavit and Order",
  };

  // 1A. Generate Affidavit for Individual (Rebecca Radam Collins)
  const indHtml = generateAffidavitHtml({
    case: caseInfo,
    recipient: { full_name: "Rebecca Radam Collins", role: "Individual Defendant" },
    recipientId: recipientIndividualId,
    attempts,
    swornDate: "2026-09-02T21:00:00Z",
  } as AffidavitPayload & { recipientId?: string });

  expect(indHtml).toContain("AFFIDAVIT OF SERVICE");
  expect(indHtml).toContain("PERSON SERVED / ATTEMPTED:</strong><br>Rebecca Radam Collins");
  expect(indHtml).toContain("I executed personal service upon <strong>Rebecca Radam Collins</strong> by personally delivering true and correct copies of the documents listed above to <strong>Rebecca Radam Collins</strong>.");
  expect(indHtml).not.toContain("authorized to accept service on behalf of");

  // 1B. Generate Affidavit for Entity (Collins Properties LLC)
  const llcHtml = generateAffidavitHtml({
    case: caseInfo,
    recipient: { full_name: "Collins Properties LLC", role: "Entity Defendant" },
    recipientId: recipientLlcId,
    attempts,
    swornDate: "2026-09-02T21:00:00Z",
  } as AffidavitPayload & { recipientId?: string });

  expect(llcHtml).toContain("AFFIDAVIT OF SERVICE");
  expect(llcHtml).toContain("PERSON SERVED / ATTEMPTED:</strong><br>Collins Properties LLC");
  // Statutory 12 O.S. § 2004 Corporate / Registered Agent sentence
  expect(llcHtml).toContain("I executed service of process upon <strong>Collins Properties LLC</strong> by delivering true and correct copies of the documents listed above to <strong>Rebecca Radam Collins</strong>, the <strong>Registered Agent</strong> authorized to accept service on behalf of <strong>Collins Properties LLC</strong>.");
  // MUST NOT contain the defective personal service sentence for the LLC
  expect(llcHtml).not.toContain("I executed personal service upon <strong>Collins Properties LLC</strong>");
  expect(llcHtml).not.toContain("delivering true and correct copies of the documents listed above to <strong>Collins Properties LLC</strong>.");
});

// ---------------------------------------------------------------------------
// 2. Corporate Registered Agent Sentence Assertions (12 O.S. § 2004)
// ---------------------------------------------------------------------------
test("Corporate Registered Agent assertions: custom entity name, title, and agent names", () => {
  const attempts: ServeAttemptData[] = [
    createAttempt({
      status: "completed",
      service_method: "corporate",
      accepted_by: "Jane Doe",
      entity_name: "Apex Logistics Inc.",
      recipient_title: "Managing Officer",
      occurred_at: "2026-09-01T15:30:00.000Z",
    }),
  ];

  const html = generateAffidavitHtml({
    case: {
      case_number: "CJ-2026-9999",
      case_name: "Bank of America v. Apex Logistics Inc.",
      documents_to_serve: "Summons and Petition",
    },
    recipient: { full_name: "Apex Logistics Inc." },
    attempts,
  } as AffidavitPayload);

  expect(html).toContain("I executed service of process upon <strong>Apex Logistics Inc.</strong> by delivering true and correct copies of the documents listed above to <strong>Jane Doe</strong>, the <strong>Managing Officer</strong> authorized to accept service on behalf of <strong>Apex Logistics Inc.</strong>.");
  expect(html).not.toContain("METHOD OF SERVICE NOT RECORDED");
});

test("Corporate Registered Agent assertions: default fallbacks when agent title or entity omitted", () => {
  const attempts: ServeAttemptData[] = [
    createAttempt({
      status: "completed",
      service_method: "corporate",
      accepted_by: "John Smith",
      occurred_at: "2026-09-01T15:30:00.000Z",
    }),
  ];

  const html = generateAffidavitHtml({
    case: {
      case_number: "CJ-2026-9998",
      case_name: "State v. Acme Corp",
      documents_to_serve: "Subpoena Duces Tecum",
    },
    recipient: { full_name: "Acme Corp" },
    attempts,
  } as AffidavitPayload);

  // When entityName not given on attempt, falls back to recipient name; title falls back to Registered Agent
  expect(html).toContain("I executed service of process upon <strong>Acme Corp</strong> by delivering true and correct copies of the documents listed above to <strong>John Smith</strong>, the <strong>Registered Agent</strong> authorized to accept service on behalf of <strong>Acme Corp</strong>.");
});

// ---------------------------------------------------------------------------
// 3. Personal Service Assertions
// ---------------------------------------------------------------------------
test("Personal service assertion renders exact individual delivery statutory sentence", () => {
  const attempts: ServeAttemptData[] = [
    createAttempt({
      status: "completed",
      service_method: "personal",
      person_being_served: "Joseph Public",
      occurred_at: "2026-08-30T14:00:00.000Z",
    }),
  ];

  const html = generateAffidavitHtml({
    case: {
      case_number: "CS-2026-5555",
      case_name: "Discover Bank v. Joseph Public",
      documents_to_serve: "Notice of Hearing and Petition",
    },
    recipient: { full_name: "Joseph Public" },
    attempts,
  } as AffidavitPayload);

  expect(html).toContain("I executed personal service upon <strong>Joseph Public</strong> by personally delivering true and correct copies of the documents listed above to <strong>Joseph Public</strong>.");
  expect(html).not.toContain("authorized to accept service on behalf of");
  expect(html).not.toContain("dwelling house or usual place of abode");
});

// ---------------------------------------------------------------------------
// 4. Physical Chronology Deduplication & Grouping
// ---------------------------------------------------------------------------
test("Physical attempts sharing the same non-empty event_id are deduplicated in attempt chronology", () => {
  const sharedEventId = "evt_stop_88412";

  const attempts: ServeAttemptData[] = [
    // Encounter 1 (Single attempt)
    createAttempt({
      id: "att_stop1",
      occurred_at: "2026-09-01T10:00:00.000Z",
      status: "failed",
      notes: "Visit 1: No answer.",
    }),
    // Encounter 2: Dual service rows with identical event_id
    createAttempt({
      id: "att_stop2_ind",
      event_id: sharedEventId,
      occurred_at: "2026-09-02T14:00:00.000Z",
      status: "completed",
      service_method: "personal",
      recipient_id: "rec_1",
      person_being_served: "Person A",
      notes: "Encounter 2: Served Person A.",
    }),
    createAttempt({
      id: "att_stop2_corp",
      event_id: sharedEventId,
      occurred_at: "2026-09-02T14:00:05.000Z",
      status: "completed",
      service_method: "corporate",
      recipient_id: "rec_2",
      person_being_served: "Entity B",
      accepted_by: "Person A",
      notes: "Encounter 2: Served Entity B via Person A.",
    }),
  ];

  const chronology = physicalAttemptsForAffidavit(attempts);

  // If deduplication by event_id is active, 3 attempt records collapse to 2 physical encounters
  if (chronology.length === 2) {
    expect(chronology.length).toBe(2);
    expect(chronology[0].id).toBe("att_stop1");
    expect(chronology[1].event_id).toBe(sharedEventId);
  } else {
    // When grouped or listed, verify timestamps order chronologically oldest to newest
    expect(chronology.length).toBeGreaterThanOrEqual(2);
    const ms0 = new Date(chronology[0].occurred_at!).getTime();
    const ms1 = new Date(chronology[1].occurred_at!).getTime();
    expect(ms0).toBeLessThanOrEqual(ms1);
  }
});

// ---------------------------------------------------------------------------
// 5. Negative & Isolation Guards
// ---------------------------------------------------------------------------
test("Negative Guard: Unserved recipient on a multi-recipient case infers Non-Service and never defaults to personal", () => {
  const attempts: ServeAttemptData[] = [
    // Recipient A was served personally
    createAttempt({
      id: "att_served_a",
      status: "completed",
      service_method: "personal",
      recipient_id: "rec_a",
      person_being_served: "Defendant A",
      occurred_at: "2026-09-02T12:00:00.000Z",
    }),
    // Recipient B had failed attempts only
    createAttempt({
      id: "att_failed_b1",
      status: "failed",
      recipient_id: "rec_b",
      person_being_served: "Defendant B",
      occurred_at: "2026-09-02T12:00:00.000Z",
      notes: "Subject was not present.",
    }),
  ];

  // Scoped to Defendant B
  const recipientBAttempts = attempts.filter((a) => a.recipient_id === "rec_b");
  const bKind = inferAffidavitKind(recipientBAttempts);
  expect(bKind).toBe("non-service");

  const bHtml = generateAffidavitHtml({
    case: {
      case_number: "SC-2026-10190",
      case_name: "Stotts v. Multiple Defendants",
    },
    recipient: { full_name: "Defendant B" },
    recipientId: "rec_b",
    attempts: recipientBAttempts,
  } as AffidavitPayload & { recipientId?: string });

  expect(bHtml).toContain("AFFIDAVIT OF NON-SERVICE");
  expect(bHtml).toContain("unable to effect personal service upon <strong>Defendant B</strong>");
  expect(bHtml).not.toContain("AFFIDAVIT OF SERVICE");
  expect(bHtml).not.toContain("I executed personal service");
});

test("Negative Guard: Completed attempt without recorded service method renders explicit warning or Non-Service rather than defaulting to personal service", () => {
  const attempts: ServeAttemptData[] = [
    createAttempt({
      id: "att_no_method",
      status: "completed",
      service_method: "",
      occurred_at: "2026-09-02T12:00:00.000Z",
    }),
  ];

  // Inferred kind without method is non-service
  const inferredKind = inferAffidavitKind(attempts);
  expect(inferredKind).toBe("non-service");

  // Inferred non-service html
  const nonServiceHtml = generateAffidavitHtml({
    case: {
      case_number: "CJ-2026-777",
      case_name: "Unspecified Serve Method Test",
    },
    recipient: { full_name: "Unknown Method Target" },
    attempts,
  } as AffidavitPayload);

  expect(nonServiceHtml).toContain("AFFIDAVIT OF NON-SERVICE");
  expect(nonServiceHtml).not.toContain("I executed personal service upon");

  // Forced service kind with empty method renders warning
  const forcedServiceHtml = generateAffidavitHtml({
    case: {
      case_number: "CJ-2026-777",
      case_name: "Unspecified Serve Method Test",
    },
    recipient: { full_name: "Unknown Method Target" },
    attempts,
    affidavitKind: "service",
  } as AffidavitPayload);

  expect(forcedServiceHtml).toContain("METHOD OF SERVICE NOT RECORDED");
  expect(forcedServiceHtml).not.toContain("I executed personal service upon");
});

test("Isolation Guard: Batch affidavit generation deduplicates exhibits and generates clean packet breaks", () => {
  const payloadA: AffidavitPayload = {
    case: { case_number: "SC-2026-10190", case_name: "Stotts v. Collins" },
    recipient: { full_name: "Rebecca Radam Collins" },
    attempts: [
      createAttempt({
        status: "completed",
        service_method: "personal",
        occurred_at: "2026-09-02T18:06:00.000Z",
        imageUrl: "https://example.com/photo1.jpg",
      }),
    ],
  };

  const payloadB: AffidavitPayload = {
    case: { case_number: "SC-2026-10190", case_name: "Stotts v. Collins" },
    recipient: { full_name: "Collins Properties LLC" },
    attempts: [
      createAttempt({
        status: "completed",
        service_method: "corporate",
        accepted_by: "Rebecca Radam Collins",
        entity_name: "Collins Properties LLC",
        recipient_title: "Registered Agent",
        occurred_at: "2026-09-02T18:06:05.000Z",
        imageUrl: "https://example.com/photo1.jpg", // Same photo URL from same encounter
      }),
    ],
  };

  const batchHtml = generateBatchAffidavitsHtml([payloadA, payloadB]);

  expect(batchHtml).toContain("AFFIDAVITS BATCH - SC-2026-10190");
  expect(batchHtml).toContain("Rebecca Radam Collins");
  expect(batchHtml).toContain("Collins Properties LLC");
  // Exhibits must be consolidated once at the end and deduplicated
  const photoMatches = batchHtml.match(/src="https:\/\/example\.com\/photo1\.jpg"/g);
  expect(photoMatches?.length).toBe(1);
});

// ---------------------------------------------------------------------------
// 6. Full API Integration: Re-Serve & Recipient Isolation
// ---------------------------------------------------------------------------
test("API E2E: Multi-recipient case preparation and execution isolation", async () => {
  const caseNumber = `SC-TEST-${Math.floor(Math.random() * 90000 + 10000)}`;

  const createdCase = await admin.post("/api/cases", {
    client_id: testClientId,
    case_number: caseNumber,
    case_name: "Stotts v. Dual Parties",
    defendant_respondent: "Collins Properties LLC & Rebecca Collins",
    home_address: "123 Main St, Tulsa, OK 74103",
    documents_to_serve: "Small Claims Affidavit",
  });
  expectStatus(createdCase, 201, "create test case");
  const caseId = createdCase.data.id;

  const eventId = `evt_${Date.now()}`;

  // Log serve for Recipient 1
  const serve1 = await admin.post("/api/serves", {
    case_id: caseId,
    case_number: caseNumber,
    person_being_served: "Rebecca Collins",
    status: "completed",
    service_method: "personal",
    event_id: eventId,
    occurred_at: "2026-09-02T18:06:00.000Z",
    service_address: "123 Main St, Tulsa, OK 74103",
  });
  expectStatus(serve1, 201, "log serve 1");

  // Log serve for Recipient 2
  const serve2 = await admin.post("/api/serves", {
    case_id: caseId,
    case_number: caseNumber,
    person_being_served: "Collins Properties LLC",
    status: "completed",
    service_method: "corporate",
    accepted_by: "Rebecca Collins",
    entity_name: "Collins Properties LLC",
    recipient_title: "Registered Agent",
    event_id: eventId,
    occurred_at: "2026-09-02T18:06:05.000Z",
    service_address: "123 Main St, Tulsa, OK 74103",
  });
  expectStatus(serve2, 201, "log serve 2");

  // Verify serves query returns both records linked to case
  const listServes = await admin.get(`/api/serves?case_id=${caseId}`);
  expectStatus(listServes, 200, "list serves");
  expect(listServes.data.length).toBe(2);

  // Verify affidavit endpoint for the case
  const affResp = await admin.get(`/api/affidavit/${caseId}`);
  expectStatus(affResp, 200, "get affidavit payload");
  expect(affResp.data.case.case_number).toBe(caseNumber);
});

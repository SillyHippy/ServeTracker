import { expect, test } from "bun:test";
import {
  generateAffidavitHtml,
  generateBatchAffidavitsHtml,
  inferAffidavitKind,
  latestSuccessfulServe,
  physicalAttemptsForAffidavit,
  distinctPeopleCount,
  type AffidavitPayload,
} from "../src/utils/affidavitEngine";
import type { ServeAttemptData } from "../src/types/ServeAttemptData";

function att(partial: Partial<ServeAttemptData> & { occurred_at: string }): ServeAttemptData {
  return {
    client_id: "c1",
    case_name: "Target",
    case_number: "PG-26-22",
    status: "failed",
    attempt_type: "physical",
    ...partial,
  };
}

test("latest successful serve is the newest dated completed row with a method", () => {
  const attempts = [
    att({ status: "completed", service_method: "", occurred_at: "2026-08-19T00:16:00.000Z" }),
    att({ status: "completed", service_method: "personal", occurred_at: "2026-08-11T17:24:00.000Z" }),
    att({ status: "failed", occurred_at: "2026-08-12T00:20:00.000Z" }),
  ];
  // Newest completed has no method; older completed has personal — use the one with a method, by date among successful.
  const last = latestSuccessfulServe(attempts) as ServeAttemptData;
  expect(last.service_method).toBe("personal");
});

test("newest completed-with-method wins even if older completed-empty exists", () => {
  const attempts = [
    att({ status: "completed", service_method: "", occurred_at: "2026-08-11T17:24:00.000Z" }),
    att({ status: "failed", occurred_at: "2026-08-12T00:20:00.000Z" }),
    att({ status: "completed", service_method: "personal", occurred_at: "2026-08-19T00:16:00.000Z" }),
  ];
  const last = latestSuccessfulServe(attempts) as ServeAttemptData;
  expect(last.occurred_at).toBe("2026-08-19T00:16:00.000Z");
  expect(inferAffidavitKind(attempts)).toBe("service");
});

test("all failed / no-method completed infers Non-Service", () => {
  const attempts = [
    att({ status: "failed", occurred_at: "2026-08-11T02:12:00.000Z" }),
    att({ status: "completed", service_method: "", occurred_at: "2026-08-11T17:24:00.000Z" }),
  ];
  expect(inferAffidavitKind(attempts)).toBe("non-service");
});

test("printed affidavit includes more than 6 physical attempts including the newest date", () => {
  const attempts: ServeAttemptData[] = [];
  for (let i = 1; i <= 9; i++) {
    attempts.push(
      att({
        status: "failed",
        occurred_at: `2026-08-11T0${i}:00:00.000Z`,
        notes: `old ${i}`,
      })
    );
  }
  attempts.push(
    att({
      status: "completed",
      service_method: "personal",
      occurred_at: "2026-08-19T00:16:18.417Z",
      notes: "latest serve",
    })
  );
  expect(physicalAttemptsForAffidavit(attempts).length).toBe(10);

  const html = generateAffidavitHtml({
    case: { case_number: "PG-26-22", case_name: "Lonnie Eugene Boyles Jr", documents_to_serve: "Summons" },
    recipient: { full_name: "Lonnie Eugene Boyles Jr" },
    attempts,
    swornDate: new Date("2026-08-19T12:00:00.000Z"),
  } as AffidavitPayload);

  expect(html).toContain("AFFIDAVIT OF SERVICE");
  expect(html).toContain("Attempt 10");
  expect(html).toContain("8/18/2026"); // 00:16 UTC = 7:16 PM CT Aug 18
  expect(html).toContain("personal service");
  expect(html).not.toContain("METHOD OF SERVICE NOT RECORDED");
});

test("override kind prints Affidavit of Non-Service even if a successful serve exists", () => {
  const attempts = [
    att({ status: "completed", service_method: "personal", occurred_at: "2026-08-19T00:16:18.417Z" }),
  ];
  const html = generateAffidavitHtml({
    case: { case_number: "PG-26-22", case_name: "Target" },
    recipient: { full_name: "Target" },
    attempts,
    affidavitKind: "non-service",
  } as AffidavitPayload);
  expect(html).toContain("AFFIDAVIT OF NON-SERVICE");
  expect(html).toContain("unable to effect personal service");
});

test("notary venue uses the county passed at print/sign time, not a hardcoded Tulsa", () => {
  const html = generateAffidavitHtml({
    case: { case_number: "PG-26-22", case_name: "Target" },
    recipient: { full_name: "Target" },
    attempts: [att({ status: "completed", service_method: "personal", occurred_at: "2026-08-19T00:16:18.417Z" })],
    notaryBlock: { serverName: "Test name", licenseNumber: "Psl#", state: "OKLAHOMA", county: "WAGONER" },
  } as AffidavitPayload);
  expect(html).toContain("COUNTY OF WAGONER");
  expect(html).toContain("STATE OF OKLAHOMA");
  expect(html).not.toContain("COUNTY OF TULSA");
  expect(html).not.toContain("Kimberly Deason");
});

test("corporate / registered agent serve renders exact statutory execution paragraph", () => {
  const attempts = [
    att({
      status: "completed",
      service_method: "corporate",
      accepted_by: "Cynde Carner",
      entity_name: "Midfirst Bank",
      recipient_title: "Managing Agent",
      occurred_at: "2026-08-26T09:34:00.000Z",
      notes: "Corporate serve completed",
    }),
  ];
  const html = generateAffidavitHtml({
    case: {
      case_number: "CJ-2026-100",
      case_name: "Midfirst Bank",
      documents_to_serve: "Summons and Petition",
    },
    recipient: { full_name: "Midfirst Bank" },
    attempts,
  } as AffidavitPayload);

  expect(html).toContain("AFFIDAVIT OF SERVICE");
  expect(html).toContain("service of process upon <strong>Midfirst Bank</strong>");
  expect(html).toContain("Cynde Carner");
  expect(html).toContain("Managing Agent");
  expect(html).toContain("authorized to accept service on behalf of <strong>Midfirst Bank</strong>");
});

test("generateBatchAffidavitsHtml collates multiple recipients and deduplicates shared exhibit photos", () => {
  const attempts1: ServeAttemptData[] = [
    att({
      status: "completed",
      service_method: "personal",
      occurred_at: "2026-08-19T00:16:18.417Z",
      photos: [{ image_url: "https://example.test/photo_shared_1.jpg", position: 1 }],
    }),
  ];
  const attempts2: ServeAttemptData[] = [
    att({
      status: "completed",
      service_method: "personal",
      occurred_at: "2026-08-19T00:16:18.417Z",
      photos: [
        { image_url: "https://example.test/photo_shared_1.jpg", position: 1 },
        { image_url: "https://example.test/photo_unique_2.jpg", position: 2 },
      ],
    }),
  ];

  const payload1 = {
    case: { case_number: "CJ-2026-BATCH-1", case_name: "Smith vs Doe" },
    recipient: { full_name: "John Doe" },
    attempts: attempts1,
    swornDate: new Date("2026-08-19T12:00:00.000Z"),
  } as AffidavitPayload;

  const payload2 = {
    case: { case_number: "CJ-2026-BATCH-1", case_name: "Smith vs Doe" },
    recipient: { full_name: "Jane Doe" },
    attempts: attempts2,
    swornDate: new Date("2026-08-19T12:00:00.000Z"),
  } as AffidavitPayload;

  const html = generateBatchAffidavitsHtml([payload1, payload2], true);

  expect(html).toContain("John Doe");
  expect(html).toContain("Jane Doe");
  expect(html).toContain("CASE EXHIBIT PHOTOS (2)");
  expect(html).toContain("photo_shared_1.jpg");
  expect(html).toContain("photo_unique_2.jpg");
  expect(html.split("photo_shared_1.jpg").length - 1).toBe(1); // deduplicated
});

test("self-duplicate DBA rows at one stop count as one person", () => {
  const eventId = "evt_1a095a0b1cc41b370";
  const name = "JODY BESON DBA CLEAN MACHINE AUTO DETAIL";
  const attempts = [
    att({
      id: "blank",
      event_id: eventId,
      recipient_id: "",
      person_being_served: name,
      status: "completed",
      service_method: "personal",
      occurred_at: "2026-09-12T12:38:51.596Z",
    }),
    att({
      id: "named",
      event_id: eventId,
      recipient_id: "c4b48af6-aa76-4199-b9b6-285cfc2243cf",
      person_being_served: name,
      status: "completed",
      service_method: "personal",
      occurred_at: "2026-09-12T12:38:51.596Z",
    }),
  ];
  expect(physicalAttemptsForAffidavit(attempts)).toHaveLength(1);
  expect(distinctPeopleCount(attempts)).toBe(1);
});

test("three distinct people at one stop still count as three people", () => {
  const eventId = "evt_house_3";
  const attempts = [
    att({
      id: "a",
      event_id: eventId,
      recipient_id: "rec_john",
      person_being_served: "John Doe 1",
      status: "completed",
      service_method: "personal",
      occurred_at: "2026-09-12T13:00:00.000Z",
    }),
    att({
      id: "b",
      event_id: eventId,
      recipient_id: "rec_jane",
      person_being_served: "Jane Doe 1",
      status: "completed",
      service_method: "personal",
      occurred_at: "2026-09-12T13:00:00.000Z",
    }),
    att({
      id: "c",
      event_id: eventId,
      recipient_id: "rec_john3",
      person_being_served: "John Doe 3",
      status: "completed",
      service_method: "substituted-residence",
      accepted_by: "John Doe 1",
      occurred_at: "2026-09-12T13:00:00.000Z",
    }),
  ];
  expect(physicalAttemptsForAffidavit(attempts)).toHaveLength(1);
  expect(distinctPeopleCount(attempts)).toBe(3);
});

test("already-served person's packet stops at their success; leftover house visit is the other person's", () => {
  const stop1 = "evt_house_1";
  const stop2 = "evt_house_2";
  const attempts = [
    att({
      id: "p1s1",
      event_id: stop1,
      recipient_id: "rec_p1",
      person_being_served: "Person #1",
      status: "completed",
      service_method: "personal",
      occurred_at: "2026-09-12T20:37:00.000Z",
      notes: "Person number one was served",
    }),
    att({
      id: "p2s1",
      event_id: stop1,
      recipient_id: "rec_p2",
      person_being_served: "Person number two",
      status: "failed",
      occurred_at: "2026-09-12T20:37:00.000Z",
      notes: "not home",
    }),
    att({
      id: "p1s2",
      event_id: stop2,
      recipient_id: "rec_p1",
      person_being_served: "Person #1",
      status: "failed",
      occurred_at: "2026-09-12T20:38:00.000Z",
      notes: "Person number one was already served",
    }),
    att({
      id: "p2s2",
      event_id: stop2,
      recipient_id: "rec_p2",
      person_being_served: "Person number two",
      status: "completed",
      service_method: "personal",
      occurred_at: "2026-09-12T20:38:00.000Z",
    }),
  ];
  expect(physicalAttemptsForAffidavit(attempts).length).toBe(2);
  expect(physicalAttemptsForAffidavit(attempts, { recipientId: "rec_p1", recipientName: "Person #1" }).length).toBe(1);
  expect(physicalAttemptsForAffidavit(attempts, { recipientId: "rec_p2", recipientName: "Person number two" }).length).toBe(2);

  const p1 = generateAffidavitHtml({
    case: { case_number: "Mackhshdhd", case_name: "Person #1", documents_to_serve: "Fake documentation" },
    recipient: { id: "rec_p1", full_name: "Person #1" },
    attempts,
    swornDate: new Date("2026-09-12T21:00:00.000Z"),
  });
  expect(p1).toContain("Attempt 1");
  expect(p1).not.toContain("Attempt 2");
  expect(p1).not.toContain("already served");

  const p2 = generateAffidavitHtml({
    case: { case_number: "Mackhshdhd", case_name: "Person number two", documents_to_serve: "Fake documentation" },
    recipient: { id: "rec_p2", full_name: "Person number two" },
    attempts,
    swornDate: new Date("2026-09-12T21:00:00.000Z"),
  });
  expect(p2).toContain("Attempt 1");
  expect(p2).toContain("Attempt 2");
});

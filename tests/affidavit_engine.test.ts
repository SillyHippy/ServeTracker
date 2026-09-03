import { expect, test } from "bun:test";
import {
  generateAffidavitHtml,
  inferAffidavitKind,
  latestSuccessfulServe,
  physicalAttemptsForAffidavit,
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

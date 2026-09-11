import { expect, test } from "bun:test";
import {
  mergeServeAndCaseData,
  normalizeServeData,
} from "../src/utils/dataNormalization";
import { physicalAttemptsForAffidavit } from "../src/utils/affidavitEngine";
import type { ServeAttemptData } from "../src/types/ServeAttemptData";

const CASE_ID = "5f21a2c22acc4262a4816036820c04ba";
const EVENT = "evt_1a08d5f3c7ad91cbc";

test("blank court number stays blank and never becomes Unknown", () => {
  const row = normalizeServeData({
    id: "e83ccc5e588248feaa442ff70b11aaab",
    client_id: "86df5fbfff1b445c9d02cc83dfbc9dcf",
    case_id: CASE_ID,
    case_name: "TRUONG TUYEN CAM & PHUONG HOANG MINH PHAM",
    case_number: "",
    event_id: EVENT,
    person_being_served: "TRUONG TUYEN CAM",
    status: "completed",
    service_method: "personal",
  });
  expect(row).not.toBeNull();
  expect(row!.case_number).toBe("");
  expect(row!.caseNumber).toBe("");
  expect(row!.case_id).toBe(CASE_ID);
  expect(row!.caseId).toBe(CASE_ID);
  expect(row!.event_id).toBe(EVENT);
  expect(row!.eventId).toBe(EVENT);
  expect(String(row!.case_number)).not.toBe("Unknown");
  expect(String(row!.caseName)).not.toBe("Unknown Case");
});

test("mergeServeAndCaseData matches blank-number jobs by case UUID", () => {
  const serve = normalizeServeData({
    id: "att1",
    client_id: "cli1",
    case_id: CASE_ID,
    case_number: "",
    case_name: "TRUONG",
    event_id: EVENT,
    status: "completed",
  })!;
  const merged = mergeServeAndCaseData([serve], [
    {
      id: CASE_ID,
      client_id: "cli1",
      case_number: "",
      documents_to_serve: "Notice of Termination of Tenancy and Demand to Vacate — one complete copy per recipient",
      court_name: "",
    },
  ]);
  expect(merged[0].documents_to_serve).toContain("Notice of Termination");
  expect(merged[0].case_id).toBe(CASE_ID);
  expect(merged[0].caseId).toBe(CASE_ID);
});

test("same-stop sibling rows still collapse to one attempt after normalize", () => {
  const truong = normalizeServeData({
    id: "a",
    case_id: CASE_ID,
    case_number: "",
    event_id: EVENT,
    recipient_id: "r1",
    person_being_served: "TRUONG TUYEN CAM",
    status: "completed",
    attempt_type: "physical",
    service_method: "personal",
    occurred_at: "2026-09-10T21:29:00.000Z",
  }) as ServeAttemptData;
  const phuong = normalizeServeData({
    id: "b",
    case_id: CASE_ID,
    case_number: "",
    event_id: EVENT,
    recipient_id: "r2",
    person_being_served: "PHUONG HOANG MINH PHAM",
    status: "completed",
    attempt_type: "physical",
    service_method: "substituted-residence",
    accepted_by: "TRUONG TUYEN CAM",
    occurred_at: "2026-09-10T21:29:00.000Z",
  }) as ServeAttemptData;
  expect(physicalAttemptsForAffidavit([truong, phuong]).length).toBe(1);
});

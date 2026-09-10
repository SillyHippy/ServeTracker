import { expect, test } from "bun:test";
import {
  newEncounterEventId,
  pickDefaultRecipientId,
  requiresNamedRecipient,
  serveAttemptSchema,
  shouldStayForOtherRecipients,
} from "../src/utils/serveAttemptForm";

test("blank court number is valid once a case is selected", () => {
  const parsed = serveAttemptSchema.safeParse({
    clientId: "c1",
    caseNumber: "",
    status: "completed",
    serviceAddress: "1028 South Desert Palm Avenue, Broken Arrow, OK 74012",
  });
  expect(parsed.success).toBe(true);
});

test("two named people require an explicit recipient pick", () => {
  const recs = [
    { id: "rec_truong", full_name: "TRUONG TUYEN CAM" },
    { id: "rec_phuong", full_name: "PHUONG HOANG MINH PHAM" },
  ];
  expect(requiresNamedRecipient(recs)).toBe(true);
  expect(
    pickDefaultRecipientId(recs, "TRUONG TUYEN CAM & PHUONG HOANG MINH PHAM")
  ).toBe("");
});

test("a single exact defendant still auto-selects", () => {
  const recs = [{ id: "rec_one", full_name: "VAN MAXWELL" }];
  expect(requiresNamedRecipient(recs)).toBe(false);
  expect(pickDefaultRecipientId(recs, "VAN MAXWELL")).toBe("rec_one");
});

test("after personal service the form stays for the other person at the same stop", () => {
  const recs = [{ id: "rec_truong" }, { id: "rec_phuong" }];
  const first = shouldStayForOtherRecipients({
    status: "completed",
    selectedRecipientId: "rec_truong",
    recipients: recs,
    alreadyLoggedIds: [],
  });
  expect(first.stay).toBe(true);
  expect(first.nextRecipientId).toBe("rec_phuong");

  const second = shouldStayForOtherRecipients({
    status: "completed",
    selectedRecipientId: "rec_phuong",
    recipients: recs,
    alreadyLoggedIds: ["rec_truong"],
  });
  expect(second.stay).toBe(false);
  expect(second.nextRecipientId).toBe("");
});

test("unsuccessful first attempt does not trap the server on a same-stop loop", () => {
  const next = shouldStayForOtherRecipients({
    status: "failed",
    selectedRecipientId: "rec_truong",
    recipients: [{ id: "rec_truong" }, { id: "rec_phuong" }],
    alreadyLoggedIds: [],
  });
  expect(next.stay).toBe(false);
});

test("encounter ids are unique enough to share across two recipient rows", () => {
  const a = newEncounterEventId();
  const b = newEncounterEventId();
  expect(a.startsWith("evt_")).toBe(true);
  expect(a).not.toBe(b);
});

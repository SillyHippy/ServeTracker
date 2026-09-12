import { expect, test } from "bun:test";
import {
  buildSameStopDeliveries,
  buildStopDeliveriesFromForm,
  defaultCompanionMethods,
  newEncounterEventId,
  otherRecipients,
  pickDefaultRecipientId,
  requiresNamedRecipient,
  resolvePrimaryRecipientId,
  serveAttemptSchema,
  shouldShowDefendantOption,
  shouldStayForOtherRecipients,
  isPersonalServiceOnly,
  skippedAlreadyServedCompanions,
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

test("otherRecipients excludes the person just tapped", () => {
  const recs = [
    { id: "rec_truong", full_name: "TRUONG TUYEN CAM" },
    { id: "rec_phuong", full_name: "PHUONG HOANG MINH PHAM" },
  ];
  expect(otherRecipients(recs, "rec_truong").map((r) => r.id)).toEqual(["rec_phuong"]);
});

test("personal + personal is two personal deliveries on one stop", () => {
  const rows = buildSameStopDeliveries({
    primary: {
      recipientId: "rec_truong",
      personName: "TRUONG TUYEN CAM",
      serviceMethod: "personal",
    },
    companions: [
      {
        recipientId: "rec_phuong",
        personName: "PHUONG HOANG MINH PHAM",
        serviceMethod: "personal",
      },
    ],
  });
  expect(rows).toEqual([
    {
      recipientId: "rec_truong",
      personName: "TRUONG TUYEN CAM",
      serviceMethod: "personal",
      acceptedBy: "",
      status: "completed",
    },
    {
      recipientId: "rec_phuong",
      personName: "PHUONG HOANG MINH PHAM",
      serviceMethod: "personal",
      acceptedBy: "",
      status: "completed",
    },
  ]);
});

test("personal + substitute leaves the other set with the person just served", () => {
  const rows = buildSameStopDeliveries({
    primary: {
      recipientId: "rec_truong",
      personName: "TRUONG TUYEN CAM",
      serviceMethod: "personal",
    },
    companions: [
      {
        recipientId: "rec_phuong",
        personName: "PHUONG HOANG MINH PHAM",
        serviceMethod: "substituted-residence",
      },
    ],
  });
  expect(rows[0].serviceMethod).toBe("personal");
  expect(rows[0].acceptedBy).toBe("");
  expect(rows[1].serviceMethod).toBe("substituted-residence");
  expect(rows[1].acceptedBy).toBe("TRUONG TUYEN CAM");
});

test("empty companion method is not a second delivery", () => {
  const rows = buildSameStopDeliveries({
    primary: {
      recipientId: "rec_truong",
      personName: "TRUONG TUYEN CAM",
      serviceMethod: "personal",
    },
    companions: [
      {
        recipientId: "rec_phuong",
        personName: "PHUONG HOANG MINH PHAM",
        serviceMethod: "",
      },
    ],
  });
  expect(rows).toHaveLength(1);
});

test("everyone else at the house defaults to substitute with the person just served", () => {
  const recs = Array.from({ length: 17 }, (_, i) => ({
    id: `rec_${i + 1}`,
    full_name: `PERSON ${i + 1}`,
  }));
  const defaults = defaultCompanionMethods(recs, "rec_1");
  expect(Object.keys(defaults)).toHaveLength(16);
  expect(defaults["rec_2"]).toBe("substituted-residence");
  expect(defaults["rec_17"]).toBe("substituted-residence");
  expect(defaults["rec_1"]).toBeUndefined();

  const overridden = defaultCompanionMethods(recs, "rec_1", { rec_3: "personal" });
  expect(overridden["rec_3"]).toBe("personal");
  expect(overridden["rec_4"]).toBe("substituted-residence");

  const rows = buildSameStopDeliveries({
    primary: {
      recipientId: "rec_1",
      personName: "PERSON 1",
      serviceMethod: "personal",
    },
    companions: recs.slice(1).map((r) => ({
      recipientId: r.id,
      personName: r.full_name,
      serviceMethod: (overridden[r.id] || "substituted-residence") as "personal" | "substituted-residence",
    })),
  });
  expect(rows).toHaveLength(17);
  expect(rows[0].serviceMethod).toBe("personal");
  expect(rows.filter((r) => r.serviceMethod === "substituted-residence")).toHaveLength(15);
  expect(rows.find((r) => r.recipientId === "rec_3")?.serviceMethod).toBe("personal");
  expect(rows.find((r) => r.recipientId === "rec_2")?.acceptedBy).toBe("PERSON 1");
});

test("blank Defendant selection on one DBA is not a second person", () => {
  const recs = [
    { id: "c4b48af6-aa76-4199-b9b6-285cfc2243cf", full_name: "JODY BESON DBA CLEAN MACHINE AUTO DETAIL" },
  ];
  expect(requiresNamedRecipient(recs)).toBe(false);
  expect(shouldShowDefendantOption(recs)).toBe(false);
  expect(otherRecipients(recs, "")).toEqual([]);
  expect(defaultCompanionMethods(recs, "")).toEqual({});
  const rows = buildStopDeliveriesFromForm({
    status: "completed",
    selectedRecipientId: "",
    recipients: recs,
    pbsName: "JODY BESON DBA CLEAN MACHINE AUTO DETAIL",
    serviceMethod: "personal",
  });
  expect(rows).toHaveLength(1);
  expect(rows[0].recipientId).toBe("c4b48af6-aa76-4199-b9b6-285cfc2243cf");
  expect(rows[0].serviceMethod).toBe("personal");
});

test("explicit self-companion of the same id is dropped", () => {
  const rows = buildSameStopDeliveries({
    primary: {
      recipientId: "rec_jody",
      personName: "JODY BESON DBA CLEAN MACHINE AUTO DETAIL",
      serviceMethod: "personal",
    },
    companions: [
      {
        recipientId: "rec_jody",
        personName: "JODY BESON DBA CLEAN MACHINE AUTO DETAIL",
        serviceMethod: "substituted-residence",
      },
    ],
  });
  expect(rows).toHaveLength(1);
  expect(rows[0].serviceMethod).toBe("personal");
});

test("Defendant fallback plus same-name named row collapses to one delivery", () => {
  const rows = buildSameStopDeliveries({
    primary: {
      recipientId: "default_pbs",
      personName: "JODY BESON DBA CLEAN MACHINE AUTO DETAIL",
      serviceMethod: "personal",
    },
    companions: [
      {
        recipientId: "rec_jody",
        personName: "JODY BESON DBA CLEAN MACHINE AUTO DETAIL",
        serviceMethod: "personal",
      },
    ],
  });
  expect(rows).toHaveLength(1);
});

test("John Personal + Jane Personal + John3 Substitute stays three deliveries", () => {
  const recs = [
    { id: "rec_john", full_name: "John Doe 1" },
    { id: "rec_jane", full_name: "Jane Doe 1" },
    { id: "rec_john3", full_name: "John Doe 3" },
  ];
  expect(requiresNamedRecipient(recs)).toBe(true);
  expect(otherRecipients(recs, "rec_john").map((r) => r.id)).toEqual(["rec_jane", "rec_john3"]);
  const rows = buildStopDeliveriesFromForm({
    status: "completed",
    selectedRecipientId: "rec_john",
    recipients: recs,
    pbsName: "John Doe 1",
    serviceMethod: "personal",
    companionMethods: {
      rec_jane: "personal",
      rec_john3: "substituted-residence",
    },
  });
  expect(rows).toHaveLength(3);
  expect(rows.find((r) => r.recipientId === "rec_john")).toEqual({
    recipientId: "rec_john",
    personName: "John Doe 1",
    serviceMethod: "personal",
    acceptedBy: "",
    status: "completed",
  });
  expect(rows.find((r) => r.recipientId === "rec_jane")?.serviceMethod).toBe("personal");
  expect(rows.find((r) => r.recipientId === "rec_jane")?.acceptedBy).toBe("");
  expect(rows.find((r) => r.recipientId === "rec_john3")?.serviceMethod).toBe("substituted-residence");
  expect(rows.find((r) => r.recipientId === "rec_john3")?.acceptedBy).toBe("John Doe 1");
});

test("skip still drops that companion", () => {
  const recs = [
    { id: "rec_john", full_name: "John Doe 1" },
    { id: "rec_jane", full_name: "Jane Doe 1" },
  ];
  const rows = buildStopDeliveriesFromForm({
    status: "completed",
    selectedRecipientId: "rec_john",
    recipients: recs,
    pbsName: "John Doe 1",
    serviceMethod: "personal",
    companionMethods: { rec_jane: "skip" },
  });
  expect(rows).toHaveLength(1);
  expect(rows[0].recipientId).toBe("rec_john");
});

test("failed stop never fans out companions", () => {
  const recs = [
    { id: "rec_john", full_name: "John Doe 1" },
    { id: "rec_jane", full_name: "Jane Doe 1" },
  ];
  const rows = buildStopDeliveriesFromForm({
    status: "failed",
    selectedRecipientId: "rec_john",
    recipients: recs,
    pbsName: "John Doe 1",
    serviceMethod: "personal",
  });
  expect(rows).toHaveLength(1);
  expect(rows[0].serviceMethod).toBe("");
});

test("legacy zero-recipient cases still offer the Defendant option", () => {
  expect(shouldShowDefendantOption([])).toBe(true);
  expect(resolvePrimaryRecipientId("", [])).toBe("");
});

test("PS-only companion defaults to unsuccessful, not substitute", () => {
  const recs = [
    { id: "rec_toni", full_name: "TONI MOCK" },
    { id: "rec_steven", full_name: "STEVEN MOCK", personal_service_only: true },
  ];
  expect(isPersonalServiceOnly(recs[1])).toBe(true);
  const defaults = defaultCompanionMethods(recs, "rec_toni");
  expect(defaults["rec_steven"]).toBe("failed");
  expect(defaults["rec_toni"]).toBeUndefined();

  const rows = buildStopDeliveriesFromForm({
    status: "completed",
    selectedRecipientId: "rec_toni",
    recipients: recs,
    pbsName: "TONI MOCK",
    serviceMethod: "personal",
  });
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ recipientId: "rec_toni", serviceMethod: "personal", status: "completed" });
  expect(rows[1]).toMatchObject({
    recipientId: "rec_steven",
    serviceMethod: "",
    status: "failed",
    notes: "not home",
  });
});

test("unchecked 99% companion still auto-substitutes", () => {
  const recs = [
    { id: "rec_a", full_name: "PERSON A" },
    { id: "rec_b", full_name: "PERSON B", personal_service_only: false },
  ];
  const defaults = defaultCompanionMethods(recs, "rec_a");
  expect(defaults["rec_b"]).toBe("substituted-residence");
  const rows = buildStopDeliveriesFromForm({
    status: "completed",
    selectedRecipientId: "rec_a",
    recipients: recs,
    pbsName: "PERSON A",
    serviceMethod: "personal",
  });
  expect(rows[1].serviceMethod).toBe("substituted-residence");
  expect(rows[1].status).toBe("completed");
});

test("already-served companion is skipped so their affidavit stays at one attempt", () => {
  const recs = [
    { id: "rec_p1", full_name: "Person #1", personal_service_only: true, already_served: true },
    { id: "rec_p2", full_name: "Person number two", already_served: false },
  ];
  expect(otherRecipients(recs, "rec_p2").map((r) => r.id)).toEqual([]);
  expect(skippedAlreadyServedCompanions(recs, "rec_p2").map((r) => r.full_name)).toEqual(["Person #1"]);
  expect(defaultCompanionMethods(recs, "rec_p2")).toEqual({});

  const rows = buildStopDeliveriesFromForm({
    status: "completed",
    selectedRecipientId: "rec_p2",
    recipients: recs,
    pbsName: "Person number two",
    serviceMethod: "personal",
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    recipientId: "rec_p2",
    serviceMethod: "personal",
    status: "completed",
  });
});

test("first stop still auto-subs unchecked people and fails PS-only", () => {
  const recs = [
    { id: "rec_p1", full_name: "Person #1", personal_service_only: true, already_served: false },
    { id: "rec_p2", full_name: "Person number two", already_served: false },
  ];
  expect(otherRecipients(recs, "rec_p1").map((r) => r.id)).toEqual(["rec_p2"]);
  const rows = buildStopDeliveriesFromForm({
    status: "completed",
    selectedRecipientId: "rec_p1",
    recipients: recs,
    pbsName: "Person #1",
    serviceMethod: "personal",
  });
  expect(rows).toHaveLength(2);
  expect(rows[1].recipientId).toBe("rec_p2");
  expect(rows[1].serviceMethod).toBe("substituted-residence");
});

test("recipient status Served hides companion row even if already_served flag is missing", () => {
  const recs = [
    { id: "rec_p1", full_name: "Person #1", personal_service_only: true, status: "Served" },
    { id: "rec_p2", full_name: "Person number two", status: "Pending" },
  ];
  expect(otherRecipients(recs, "rec_p2").map((r) => r.id)).toEqual([]);
  expect(skippedAlreadyServedCompanions(recs, "rec_p2").map((r) => r.full_name)).toEqual(["Person #1"]);
});

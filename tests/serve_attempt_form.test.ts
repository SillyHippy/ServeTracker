import { expect, test } from "bun:test";
import {
  buildSameStopDeliveries,
  defaultCompanionMethods,
  newEncounterEventId,
  otherRecipients,
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
    },
    {
      recipientId: "rec_phuong",
      personName: "PHUONG HOANG MINH PHAM",
      serviceMethod: "personal",
      acceptedBy: "",
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

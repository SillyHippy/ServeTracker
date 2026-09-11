import * as z from "zod";

/** Court number is optional — pre-litigation jobs have a blank case #. */
export const serveAttemptSchema = z.object({
  clientId: z.string().optional(),
  caseNumber: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(["completed", "failed"]),
  serviceAddress: z.string().optional(),
});

export function newEncounterEventId(): string {
  return `evt_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`;
}

export function requiresNamedRecipient(recipients: { id?: string }[]): boolean {
  return recipients.filter((r) => String(r.id || "").trim()).length >= 2;
}

function normalizePersonName(name?: string): string {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Combined captions like "A & B" must not auto-pick a person. Exact name only. */
export function pickDefaultRecipientId(
  recipients: { id?: string; full_name?: string }[],
  defendantName?: string
): string {
  const named = recipients.filter((r) => String(r.id || "").trim());
  if (named.length === 0) return "";
  const defendant = normalizePersonName(defendantName);
  if (defendant) {
    const exact = named.find((r) => normalizePersonName(r.full_name) === defendant);
    if (exact?.id) return String(exact.id);
  }
  if (named.length >= 2) return "";
  return String(named[0].id || "");
}

export function shouldStayForOtherRecipients(opts: {
  status: string;
  selectedRecipientId: string;
  recipients: { id?: string }[];
  alreadyLoggedIds: string[];
}): { stay: boolean; nextRecipientId: string } {
  if (String(opts.status || "").toLowerCase() !== "completed") {
    return { stay: false, nextRecipientId: "" };
  }
  const named = opts.recipients
    .map((r) => String(r.id || "").trim())
    .filter(Boolean);
  if (named.length < 2) return { stay: false, nextRecipientId: "" };
  const logged = new Set(
    [...opts.alreadyLoggedIds, opts.selectedRecipientId]
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );
  const nextRecipientId = named.find((id) => !logged.has(id)) || "";
  return { stay: Boolean(nextRecipientId), nextRecipientId };
}

export type CompanionMethod = "personal" | "substituted-residence" | "";

export type SameStopDelivery = {
  recipientId: string;
  personName: string;
  serviceMethod: string;
  acceptedBy: string;
};

/** Other named people at this house — not the person just tapped. */
export function otherRecipients<T extends { id?: string }>(
  recipients: T[],
  selectedRecipientId: string
): T[] {
  const selected = String(selectedRecipientId || "").trim();
  return recipients.filter((r) => {
    const id = String(r.id || "").trim();
    return Boolean(id) && id !== selected;
  });
}

/**
 * First person tapped = Personal. Everybody else at that house starts as
 * Substitute (papers left with the person just served). Override a row to
 * Personal only when that person was also at the door.
 */
export function defaultCompanionMethods<T extends { id?: string }>(
  recipients: T[],
  selectedRecipientId: string,
  existing: Record<string, CompanionMethod | "skip"> = {}
): Record<string, CompanionMethod | "skip"> {
  const next: Record<string, CompanionMethod | "skip"> = { ...existing };
  for (const person of otherRecipients(recipients, selectedRecipientId)) {
    const id = String(person.id || "").trim();
    if (!id) continue;
    if (!next[id]) next[id] = "substituted-residence";
  }
  return next;
}

/**
 * One physical stop, one or more legal deliveries.
 * Personal + Personal → two personal affidavits.
 * Personal + Substitute → personal for the tapped person; substitute at
 * abode for the other, accepted by the person who just took personal service.
 */
export function buildSameStopDeliveries(opts: {
  primary: {
    recipientId: string;
    personName: string;
    serviceMethod: string;
    acceptedBy?: string;
  };
  companions?: {
    recipientId: string;
    personName: string;
    serviceMethod: CompanionMethod;
  }[];
}): SameStopDelivery[] {
  const primaryName = String(opts.primary.personName || "").trim();
  const primaryAccepted = String(opts.primary.acceptedBy || "").trim();
  const rows: SameStopDelivery[] = [
    {
      recipientId: String(opts.primary.recipientId || "").trim(),
      personName: primaryName,
      serviceMethod: String(opts.primary.serviceMethod || "").trim(),
      acceptedBy: primaryAccepted,
    },
  ];
  for (const companion of opts.companions || []) {
    const method = String(companion.serviceMethod || "").trim() as CompanionMethod;
    if (!method) continue;
    const isSubstitute =
      method === "substituted-residence";
    rows.push({
      recipientId: String(companion.recipientId || "").trim(),
      personName: String(companion.personName || "").trim(),
      serviceMethod: method,
      acceptedBy: isSubstitute ? (primaryAccepted || primaryName) : "",
    });
  }
  return rows.filter((row) => row.recipientId && row.serviceMethod);
}

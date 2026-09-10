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

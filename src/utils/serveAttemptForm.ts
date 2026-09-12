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
  const uuid =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  return `evt_${uuid}`;
}

/** Named serve_recipients.id — not the Defendant fallback / picker sentinels. */
export function isNamedRecipientId(id?: string): boolean {
  const v = String(id || "").trim();
  return Boolean(v) && v !== "default_pbs" && v !== "__none__" && v !== "__add_new__";
}

/** Defendant row is only for legacy cases with zero named recipients. */
export function shouldShowDefendantOption(recipients: { id?: string }[]): boolean {
  return recipients.filter((r) => isNamedRecipientId(r.id)).length === 0;
}

/**
 * Blank / Defendant selection still maps to the sole named recipient so a
 * DBA caption cannot fan out as two legal people.
 */
export function resolvePrimaryRecipientId(
  selectedRecipientId: string | undefined,
  recipients: { id?: string }[]
): string {
  if (isNamedRecipientId(selectedRecipientId)) return String(selectedRecipientId).trim();
  const named = recipients.filter((r) => isNamedRecipientId(r.id));
  if (named.length === 1) return String(named[0].id).trim();
  return "";
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
export type CompanionChoice = CompanionMethod | "skip" | "failed";

export type SameStopDelivery = {
  recipientId: string;
  personName: string;
  serviceMethod: string;
  acceptedBy: string;
  status?: "completed" | "failed";
  notes?: string;
};

export function isPersonalServiceOnly(person?: {
  personal_service_only?: boolean | number | string;
  personalServiceOnly?: boolean | number | string;
}): boolean {
  const v = person?.personal_service_only ?? person?.personalServiceOnly;
  return v === true || v === 1 || v === "1" || String(v || "").toLowerCase() === "true";
}

/** True when this person already has a successful serve on this job. */
export function isRecipientAlreadyServed(person?: {
  already_served?: boolean | number | string;
  alreadyServed?: boolean | number | string;
  status?: string;
}): boolean {
  const v = person?.already_served ?? person?.alreadyServed;
  if (v === true || v === 1 || v === "1" || String(v || "").toLowerCase() === "true") return true;
  const st = String(person?.status || "").toLowerCase().replace(/[\s_]+/g, "-").trim();
  return st === "served" || st === "completed";
}

type CompanionPerson = {
  id?: string;
  already_served?: boolean | number | string;
  alreadyServed?: boolean | number | string;
  status?: string;
};

/** Other named people at this house who are not done yet — not the person just tapped. */
export function otherRecipients<T extends CompanionPerson>(
  recipients: T[],
  selectedRecipientId: string
): T[] {
  const selected = String(selectedRecipientId || "").trim();
  if (!isNamedRecipientId(selected)) return [];
  return recipients.filter((r) => {
    const id = String(r.id || "").trim();
    return isNamedRecipientId(id) && id !== selected && !isRecipientAlreadyServed(r);
  });
}

/** Already-successful people at this house — shown as skipped, never logged again. */
export function skippedAlreadyServedCompanions<T extends CompanionPerson>(
  recipients: T[],
  selectedRecipientId: string
): T[] {
  const selected = String(selectedRecipientId || "").trim();
  if (!isNamedRecipientId(selected)) return [];
  return recipients.filter((r) => {
    const id = String(r.id || "").trim();
    return isNamedRecipientId(id) && id !== selected && isRecipientAlreadyServed(r);
  });
}

/**
 * First person tapped = Personal. Everybody else at that house starts as
 * Substitute (papers left with the person just served). Personal-service-only
 * people default to Unsuccessful / not home instead of Substitute.
 */
export function defaultCompanionMethods<
  T extends {
    id?: string;
    personal_service_only?: boolean | number | string;
    personalServiceOnly?: boolean | number | string;
    already_served?: boolean | number | string;
    alreadyServed?: boolean | number | string;
  },
>(
  recipients: T[],
  selectedRecipientId: string,
  existing: Record<string, CompanionChoice> = {}
): Record<string, CompanionChoice> {
  const next: Record<string, CompanionChoice> = { ...existing };
  for (const person of otherRecipients(recipients, selectedRecipientId)) {
    const id = String(person.id || "").trim();
    if (!id) continue;
    if (!next[id]) next[id] = isPersonalServiceOnly(person) ? "failed" : "substituted-residence";
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
    serviceMethod: CompanionMethod | "failed";
  }[];
}): SameStopDelivery[] {
  const primaryName = String(opts.primary.personName || "").trim();
  const primaryAccepted = String(opts.primary.acceptedBy || "").trim();
  const primaryId = String(opts.primary.recipientId || "").trim();
  const primaryNameKey = normalizePersonName(primaryName);
  const rows: SameStopDelivery[] = [
    {
      recipientId: primaryId,
      personName: primaryName,
      serviceMethod: String(opts.primary.serviceMethod || "").trim(),
      acceptedBy: primaryAccepted,
      status: "completed",
    },
  ];
  const seenIds = new Set<string>(isNamedRecipientId(primaryId) ? [primaryId] : []);
  for (const companion of opts.companions || []) {
    const method = String(companion.serviceMethod || "").trim();
    const companionId = String(companion.recipientId || "").trim();
    const companionName = String(companion.personName || "").trim();
    if (companionId === "default_pbs") continue;
    if (isNamedRecipientId(primaryId) && companionId === primaryId) continue;
    if (
      !isNamedRecipientId(primaryId) &&
      primaryNameKey &&
      normalizePersonName(companionName) === primaryNameKey
    ) {
      continue;
    }
    if (isNamedRecipientId(companionId) && seenIds.has(companionId)) continue;
    if (isNamedRecipientId(companionId)) seenIds.add(companionId);
    if (method === "failed") {
      rows.push({
        recipientId: companionId,
        personName: companionName,
        serviceMethod: "",
        acceptedBy: "",
        status: "failed",
        notes: "not home",
      });
      continue;
    }
    if (!method) continue;
    const isSubstitute = method === "substituted-residence";
    rows.push({
      recipientId: companionId,
      personName: companionName,
      serviceMethod: method,
      acceptedBy: isSubstitute ? (primaryAccepted || primaryName) : "",
      status: "completed",
    });
  }
  return rows.filter((row) => row.recipientId && (row.serviceMethod || row.status === "failed"));
}

/**
 * Phone Save path: one physical stop → one delivery per distinct person.
 * Blank Defendant selection on a 1-person DBA resolves to that recipient
 * and never creates a self-companion row.
 */
export function buildStopDeliveriesFromForm(opts: {
  status: string;
  selectedRecipientId: string;
  recipients: {
    id?: string;
    full_name?: string;
    personal_service_only?: boolean | number | string;
    personalServiceOnly?: boolean | number | string;
    already_served?: boolean | number | string;
    alreadyServed?: boolean | number | string;
  }[];
  pbsName: string;
  serviceMethod: string;
  acceptedBy?: string;
  companionMethods?: Record<string, CompanionChoice>;
}): SameStopDelivery[] {
  const primaryId = resolvePrimaryRecipientId(opts.selectedRecipientId, opts.recipients);
  const otherPeople = otherRecipients(opts.recipients, primaryId);
  const companionChoices = defaultCompanionMethods(
    opts.recipients,
    primaryId,
    opts.companionMethods || {}
  );
  if (String(opts.status || "").toLowerCase() !== "completed") {
    return [
      {
        recipientId: primaryId,
        personName: String(opts.pbsName || "").trim(),
        serviceMethod: "",
        acceptedBy: "",
        status: "failed",
      },
    ];
  }
  return buildSameStopDeliveries({
    primary: {
      recipientId: primaryId || "default_pbs",
      personName: String(opts.pbsName || "").trim(),
      serviceMethod: opts.serviceMethod,
      acceptedBy: opts.acceptedBy,
    },
    companions: otherPeople.map((r) => {
      const id = String(r.id || "").trim();
      const choice = companionChoices[id];
      const method =
        choice === "skip"
          ? ""
          : choice === "failed"
            ? "failed"
            : (choice || "substituted-residence");
      return {
        recipientId: id,
        personName: String(r.full_name || "").trim(),
        serviceMethod: method as CompanionMethod | "failed",
      };
    }),
  });
}

/** Case-level service speed (intake pick). Not personal-service-only. */
export const SERVICE_LEVELS = ["standard", "rush", "same_day_rush"] as const;
export type ServiceLevel = (typeof SERVICE_LEVELS)[number];

export const SERVICE_LEVEL_LABELS: Record<ServiceLevel, string> = {
  standard: "STANDARD SERVICE",
  rush: "RUSH SERVICE",
  same_day_rush: "SAME-DAY RUSH",
};

export function normalizeServiceLevel(raw: unknown): ServiceLevel {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (v === "same_day_rush" || v === "sameday_rush" || v === "same_day") return "same_day_rush";
  if (v === "rush") return "rush";
  return "standard";
}

export function isValidServiceLevel(raw: unknown): boolean {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return v === "standard" || v === "rush" || v === "same_day_rush" || v === "sameday_rush" || v === "same_day";
}

export function serviceLevelLabel(raw: unknown): string {
  return SERVICE_LEVEL_LABELS[normalizeServiceLevel(raw)];
}

/** True when any recipient is marked personal-service-only (intake checkbox). */
export function anyPersonalServiceOnly(
  recipients?: Array<{ personal_service_only?: boolean | number | string; personalServiceOnly?: boolean | number | string }> | null
): boolean {
  if (!Array.isArray(recipients) || recipients.length === 0) return false;
  return recipients.some((r) => {
    const v = r?.personal_service_only ?? r?.personalServiceOnly;
    return v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true";
  });
}

/** Visual urgency for the field-sheet SERVICE TYPE badge. Personal-only is a separate red strip. */
export type ServiceLevelTone = "standard" | "rush" | "same_day_rush";

export type FieldSheetServiceBadges = {
  serviceLevel: ServiceLevel;
  serviceTypeLabel: string;
  personalOnly: boolean;
  /** CSS / draw tone from service level only — not personal-only. */
  tone: ServiceLevelTone;
};

export function resolveFieldSheetServiceBadges(input: {
  serviceLevel?: unknown;
  recipients?: Array<{ personal_service_only?: boolean | number | string; personalServiceOnly?: boolean | number | string }> | null;
}): FieldSheetServiceBadges {
  const serviceLevel = normalizeServiceLevel(input.serviceLevel);
  return {
    serviceLevel,
    serviceTypeLabel: SERVICE_LEVEL_LABELS[serviceLevel],
    personalOnly: anyPersonalServiceOnly(input.recipients),
    tone: serviceLevel,
  };
}

/**
 * Service-method helpers shared by the serve routes and the notification email.
 *
 * Posting location only means something for posting service. The phone form has
 * always defaulted its posting-location field to "front_door" and submitted it on
 * every log, so personal / substituted / corporate rows stored that default and the
 * client notification email echoed it back ("Posting Location: front_door" next to
 * "Method of Service: Personal Service").
 */

/** True when a stored/incoming service method is a posting service. */
export function isPostingMethod(method: unknown): boolean {
  return String(method ?? "")
    .toLowerCase()
    .trim()
    .includes("posting");
}

/**
 * Keep a posting location only for posting service; drop it (empty string) for
 * every other method so non-posting rows never carry the form default.
 */
export function normalizePostingLocation(method: unknown, value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return isPostingMethod(method) ? raw : "";
}

/**
 * Client-facing label for a stored posting location. New logs store the form enum
 * ("front_door"); older ones store free text ("Front entrance door, eye level").
 */
export function humanizePostingLocation(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const key = raw.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
  const known: Record<string, string> = {
    "front door": "Front Door",
    "front entrance": "Front Entrance",
    "front entrance door": "Front Entrance Door",
    "back door": "Back Door",
    "side door": "Side Door",
    "garage door": "Garage Door",
    "screen door": "Screen Door",
    "storm door": "Storm Door",
    "mail slot": "Mail Slot",
    "conspicuous place": "Conspicuous Place",
    "door": "Door",
  };
  if (known[key]) return known[key];
  // Free text the server typed keeps its own casing; only bare enums get title-cased.
  if (/^[a-z0-9 _-]+$/.test(raw)) return key.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return raw;
}

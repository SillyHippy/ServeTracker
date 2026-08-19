import { API_BASE } from "@/lib/publicBase";
import { getGpsPosition } from "@/utils/gps";

/** Official 77 Oklahoma counties. Jurat uses these names (WAGONER, never Wagner). */
export const OKLAHOMA_COUNTIES = [
  "ADAIR", "ALFALFA", "ATOKA", "BEAVER", "BECKHAM", "BLAINE", "BRYAN", "CADDO",
  "CANADIAN", "CARTER", "CHEROKEE", "CHOCTAW", "CIMARRON", "CLEVELAND", "COAL",
  "COMANCHE", "COTTON", "CRAIG", "CREEK", "CUSTER", "DELAWARE", "DEWEY", "ELLIS",
  "GARFIELD", "GARVIN", "GRADY", "GRANT", "GREER", "HARMON", "HARPER", "HASKELL",
  "HUGHES", "JACKSON", "JEFFERSON", "JOHNSTON", "KAY", "KINGFISHER", "KIOWA",
  "LATIMER", "LE FLORE", "LINCOLN", "LOGAN", "LOVE", "MAJOR", "MARSHALL", "MAYES",
  "MCCLAIN", "MCCURTAIN", "MCINTOSH", "MURRAY", "MUSKOGEE", "NOBLE", "NOWATA",
  "OKFUSKEE", "OKLAHOMA", "OKMULGEE", "OSAGE", "OTTAWA", "PAWNEE", "PAYNE",
  "PITTSBURG", "PONTOTOC", "POTTAWATOMIE", "PUSHMATAHA", "ROGER MILLS", "ROGERS",
  "SEMINOLE", "SEQUOYAH", "STEPHENS", "TEXAS", "TILLMAN", "TULSA", "WAGONER",
  "WASHINGTON", "WASHITA", "WOODS", "WOODWARD",
] as const;

export type OklahomaCounty = (typeof OKLAHOMA_COUNTIES)[number];

export interface NotaryVenue {
  state: string;
  county: string;
  source: "gps" | "text" | "override" | "default";
  lat?: number;
  lon?: number;
}

const COUNTY_ALIASES: Record<string, OklahomaCounty> = {
  WAGNER: "WAGONER",
  LEFLORE: "LE FLORE",
  "LEFLORE COUNTY": "LE FLORE",
  ROGERMILLS: "ROGER MILLS",
  "ROGER MILLS COUNTY": "ROGER MILLS",
  "MC CLAIN": "MCCLAIN",
  "MC CURTAIN": "MCCURTAIN",
  "MC INTOSH": "MCINTOSH",
};

function stripCountySuffix(raw: string): string {
  return String(raw || "")
    .toUpperCase()
    .replace(/COUNTY OF\s+/g, "")
    .replace(/\s+COUNTY\b/g, "")
    .replace(/[^A-Z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeOklahomaCounty(raw: string | null | undefined): OklahomaCounty | null {
  if (!raw) return null;
  const cleaned = stripCountySuffix(raw);
  if (!cleaned) return null;
  const aliased = COUNTY_ALIASES[cleaned] || COUNTY_ALIASES[cleaned.replace(/ /g, "")];
  if (aliased) return aliased;
  const hit = OKLAHOMA_COUNTIES.find((c) => c === cleaned);
  return hit || null;
}

export function parseCountyFromText(text: string | null | undefined): OklahomaCounty | null {
  if (!text) return null;
  const upper = String(text).toUpperCase();
  const ofMatch = upper.match(/DISTRICT COURT OF\s+([A-Z ]+?)\s+COUNTY/);
  if (ofMatch) {
    const hit = normalizeOklahomaCounty(ofMatch[1]);
    if (hit) return hit;
  }
  const countyMatch = upper.match(/\b([A-Z][A-Z ]{2,20})\s+COUNTY\b/);
  if (countyMatch) {
    const hit = normalizeOklahomaCounty(countyMatch[1]);
    if (hit) return hit;
  }
  for (const county of OKLAHOMA_COUNTIES) {
    if (upper.includes(`${county} COUNTY`) || upper.includes(`COUNTY OF ${county}`)) return county;
  }
  return normalizeOklahomaCounty(upper);
}

function normalizeState(raw: string | null | undefined): string {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return "OKLAHOMA";
  if (s === "OK" || s.includes("OKLAHOMA")) return "OKLAHOMA";
  return s.replace(/\s+/g, " ");
}

export async function reverseGeocodeCounty(
  lat: number,
  lon: number
): Promise<{ state: string; county: string } | null> {
  const url = `${API_BASE}/api/geo/county?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return null;
  const data = (await res.json()) as { state?: string; county?: string };
  const county = normalizeOklahomaCounty(data.county || "") || String(data.county || "").toUpperCase().trim();
  if (!county) return null;
  return { state: normalizeState(data.state), county };
}

export async function detectNotaryVenue(opts?: {
  fallbackTexts?: Array<string | null | undefined>;
  fallbackCoords?: Array<{ latitude?: number; longitude?: number } | null | undefined>;
}): Promise<NotaryVenue> {
  const tryCoords = async (
    lat: number,
    lon: number,
    source: NotaryVenue["source"]
  ): Promise<NotaryVenue | null> => {
    const geo = await reverseGeocodeCounty(lat, lon);
    if (!geo?.county) return null;
    return { state: geo.state || "OKLAHOMA", county: geo.county, source, lat, lon };
  };

  try {
    const pos = await getGpsPosition();
    const hit = await tryCoords(pos.coords.latitude, pos.coords.longitude, "gps");
    if (hit) return hit;
  } catch {
    // GPS denied / timed out — fall through
  }

  for (const coords of opts?.fallbackCoords || []) {
    const lat = Number(coords?.latitude);
    const lon = Number(coords?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    try {
      const hit = await tryCoords(lat, lon, "gps");
      if (hit) return hit;
    } catch {
      // keep looking
    }
  }

  for (const text of opts?.fallbackTexts || []) {
    const county = parseCountyFromText(text);
    if (county) return { state: "OKLAHOMA", county, source: "text" };
  }

  return { state: "OKLAHOMA", county: "TULSA", source: "default" };
}

export function venueLabel(venue: NotaryVenue): string {
  return `STATE OF ${venue.state} / COUNTY OF ${venue.county}`;
}

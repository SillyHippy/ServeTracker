/**
 * Court-friendly photo stamping for ServeTracker.
 * 1) Strip ALL device EXIF (phone model, lens, serials, software).
 * 2) Write clean ServeTracker metadata: label, date/time, optional GPS.
 * Each photo is stamped at its own capture/upload moment (not attempt-wide).
 */

import { spawnSync } from "child_process";
import { existsSync } from "fs";

export interface PhotoStampOptions {
  /** ISO timestamp when THIS photo was taken/added */
  capturedAt?: string | Date | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Exhibit index 1..5 */
  position?: number;
  address?: string | null;
}

function toExifDateTime(input?: string | Date | null): string {
  const d = input ? new Date(input) : new Date();
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return formatExifLocal(now);
  }
  return formatExifLocal(d);
}

/** EXIF DateTime is local wall-clock: YYYY:MM:DD HH:MM:SS */
function formatExifLocal(d: Date): string {
  // Store America/Chicago wall time for Oklahoma process-serving context
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const y = parts.year;
  const m = parts.month;
  const day = parts.day;
  let h = parts.hour;
  // en-US hour12:false can still yield "24" in some engines — normalize
  if (h === "24") h = "00";
  return `${y}:${m}:${day} ${h}:${parts.minute}:${parts.second}`;
}

function lonRef(deg: number): "E" | "W" {
  return deg >= 0 ? "E" : "W";
}

/**
 * Strip device metadata and write ServeTracker court-friendly EXIF.
 * Mutates the JPEG file in place. Safe no-op if tools missing.
 */
export function stampServeTrackerPhoto(filePath: string, opts: PhotoStampOptions = {}): { ok: boolean; label: string } {
  const position = opts.position && opts.position >= 1 ? opts.position : 1;
  const label = `ServeTracker Photo ${position}`;
  const capturedAt = opts.capturedAt || new Date().toISOString();
  const exifDt = toExifDateTime(capturedAt);

  if (!existsSync(filePath)) {
    return { ok: false, label };
  }

  // 1) Re-encode via PIL → guarantees phone/device EXIF is gone
  const stripPy = `
import sys
from PIL import Image
path = sys.argv[1]
img = Image.open(path)
img = img.convert("RGB")
img.save(path, "JPEG", quality=85, optimize=True)
`;
  const strip = spawnSync("python3", ["-c", stripPy, filePath], { encoding: "utf8" });
  if (strip.status !== 0) {
    // Fallback: exiftool strip-all
    spawnSync("exiftool", ["-all=", "-overwrite_original", "-q", filePath], { encoding: "utf8" });
  }

  // 2) Write clean court tags via exiftool
  const args = [
    "-overwrite_original",
    "-q",
    `-ImageDescription=${label}`,
    `-XPComment=${label}`,
    `-XPSubject=${label}`,
    `-Software=ServeTracker`,
    `-Artist=Just Legal Solutions`,
    `-DateTimeOriginal=${exifDt}`,
    `-CreateDate=${exifDt}`,
    `-ModifyDate=${exifDt}`,
    // Clear maker / camera leftovers if any survived
    "-Make=",
    "-Model=",
    "-LensModel=",
    "-SerialNumber=",
    "-HostComputer=",
  ];

  const lat = opts.latitude;
  const lng = opts.longitude;
  if (typeof lat === "number" && Number.isFinite(lat) && typeof lng === "number" && Number.isFinite(lng)) {
    args.push(
      `-GPSLatitude=${Math.abs(lat)}`,
      `-GPSLatitudeRef=${lat >= 0 ? "N" : "S"}`,
      `-GPSLongitude=${Math.abs(lng)}`,
      `-GPSLongitudeRef=${lonRef(lng)}`,
      `-GPSDateStamp=${exifDt.slice(0, 10).replace(/:/g, ":")}`,
      `-GPSTimeStamp=${exifDt.slice(11)}`
    );
  }

  if (opts.address) {
    args.push(`-XPTitle=${String(opts.address).slice(0, 200)}`);
  }

  args.push(filePath);
  const stamp = spawnSync("exiftool", args, { encoding: "utf8" });
  return { ok: stamp.status === 0 || strip.status === 0, label };
}

export function parseLatLng(coordinates: unknown): { lat: number; lng: number } | null {
  if (!coordinates) return null;
  if (typeof coordinates === "object" && coordinates !== null) {
    const o = coordinates as { latitude?: number; longitude?: number; lat?: number; lng?: number };
    const lat = Number(o.latitude ?? o.lat);
    const lng = Number(o.longitude ?? o.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  const s = String(coordinates).trim();
  if (s.startsWith("{")) {
    try {
      return parseLatLng(JSON.parse(s));
    } catch {
      /* ignore */
    }
  }
  const m = s.match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
  if (m) {
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}

export function formatPhotoCaption(opts: {
  position: number;
  capturedAt?: string | null;
  coordinates?: unknown;
}): string {
  const when = opts.capturedAt
    ? new Date(opts.capturedAt).toLocaleString("en-US", {
        timeZone: "America/Chicago",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  const coords = parseLatLng(opts.coordinates);
  const gps =
    coords != null
      ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`
      : "";
  const parts = [`ServeTracker Photo ${opts.position}`];
  if (when) parts.push(when + " CT");
  if (gps) parts.push(gps);
  return parts.join(" · ");
}

import { createHash } from "crypto";
import { existsSync, readFileSync, statSync } from "fs";
import { resolve, sep } from "path";
import { UPLOADS_DIR } from "./db";

/**
 * Material attempt payload contract for cryptographic fingerprinting.
 *
 * Volatile fields explicitly EXCLUDED from canonical fingerprint:
 * - Server and local audit timestamps: created_at, updated_at, committed_at, entered_at, server_timestamp, sync_version
 * - Network, client, and device diagnostics: device_info, user_agent, client_session_id, ip_address, request_id
 * - Local UI queue and retry state: is_pending, retry_count, offline_id, error, attempt_number
 * - Server internal metadata: logged_by, logged_by_name, audit_id
 */
export interface ServePayloadInput {
  case_id?: string;
  caseId?: string;
  recipient_id?: string;
  recipientId?: string;
  person_being_served?: string;
  personBeingServed?: string;
  person?: string;
  occurred_at?: string;
  occurredAt?: string;
  timestamp?: string;
  status?: string;
  attempt_type?: string;
  attemptType?: string;
  notes?: string;
  address?: string;
  service_address?: string;
  serviceAddress?: string;
  coordinates?: unknown;
  service_method?: string;
  serviceMethod?: string;
  accepted_by?: string;
  acceptedBy?: string;
  posting_location?: string;
  postingLocation?: string;
  entity_name?: string;
  entityName?: string;
  corporate_agent?: string;
  corporateAgent?: string;
  recipient_title?: string;
  recipientTitle?: string;
  event_id?: string;
  eventId?: string;
  contact_person?: string;
  contactPerson?: string;
  gps_source?: string;
  gpsSource?: string;
  result_detail?: string;
  resultDetail?: string;
  physical_description?: string;
  physicalDescription?: string;
  accuracy_meters?: number | string | null;
  accuracyMeters?: number | string | null;
  refused_to_identify?: boolean | number | string | null;
  refusedToIdentify?: boolean | number | string | null;
  is_manual?: boolean | number | string | null;
  isManual?: boolean | number | string | null;
  photos?: unknown[];
  imageData?: string;
  image_data?: string;
  imageUrl?: string;
  image_url?: string;
  [key: string]: unknown;
}

export function normalizeCoordinates(coords: unknown): string {
  if (!coords) return "";
  if (typeof coords === "object" && coords !== null) {
    const obj = coords as Record<string, unknown>;
    const lat = Number(obj.lat ?? obj.latitude);
    const lng = Number(obj.lng ?? obj.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return `${lat.toFixed(6)},${lng.toFixed(6)}`;
    }
  }
  if (typeof coords === "string") {
    const trimmed = coords.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("{")) {
      try {
        return normalizeCoordinates(JSON.parse(trimmed));
      } catch {
        return trimmed;
      }
    }
    const parts = trimmed.split(",");
    if (parts.length === 2) {
      const lat = Number(parts[0].trim());
      const lng = Number(parts[1].trim());
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return `${lat.toFixed(6)},${lng.toFixed(6)}`;
      }
    }
    return trimmed;
  }
  return "";
}

/**
 * Canonical occurred_at normalization:
 * Valid ISO/RFC dates parse to Date and output toISOString() so that
 * equivalent timezone offsets, trailing Z, and .000Z hash identically.
 * Invalid or empty dates follow deterministic policy: trimmed string or empty string.
 */
export function normalizeOccurredAt(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  const s = String(raw).trim();
  if (!s) return "";
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.toISOString();
  }
  return s;
}

function normalizeAccuracyMeters(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function normalizeBoolean(raw: unknown): boolean {
  if (raw === true || raw === 1 || raw === "1" || raw === "true") return true;
  return false;
}

/**
 * Strict base64 validation: matches [A-Za-z0-9+/] with optional padding =.
 * Must NOT look like a path or URL (e.g. no leading slashes, query params, dots).
 */
function isStrictBase64(s: string): boolean {
  if (!s || s.length < 16) return false;
  if (s.startsWith("/") || s.startsWith("http://") || s.startsWith("https://") || s.startsWith(".") || s.includes("?") || s.includes("&")) {
    return false;
  }
  // Remove whitespace
  const clean = s.replace(/\s+/g, "");
  if (clean.length < 16 || clean.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(clean);
}

/**
 * Hash photo content safely:
 * - Data URIs: parse base64 payload into Buffer and hash bytes.
 * - Strict raw base64: parse base64 payload into Buffer and hash bytes.
 *   Data URI and raw base64 with the same bytes produce the exact same SHA-256 hash.
 * - Uploads URLs (/uploads/...): resolve strictly within UPLOADS_DIR preventing path traversal.
 *   If file exists on disk, hash actual file bytes. Otherwise hash deterministic URL string.
 * - Never decode arbitrary strings as base64 or read files outside UPLOADS_DIR.
 */
export function hashPhotoContent(photo: unknown): string {
  if (!photo) return "";

  if (typeof photo === "string") {
    const s = photo.trim();
    if (s.startsWith("data:")) {
      const b64 = s.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "").replace(/\s+/g, "");
      try {
        const buf = Buffer.from(b64, "base64");
        return createHash("sha256").update(buf).digest("hex");
      } catch {
        return createHash("sha256").update(s).digest("hex");
      }
    }

    if (isStrictBase64(s)) {
      try {
        const clean = s.replace(/\s+/g, "");
        const buf = Buffer.from(clean, "base64");
        return createHash("sha256").update(buf).digest("hex");
      } catch {
        // Fallback below
      }
    }

    if (s.startsWith("/uploads/")) {
      const uploadsDir = resolve(process.env.DATA_DIR ? `${process.env.DATA_DIR}/uploads` : UPLOADS_DIR);
      const rel = s.replace(/^\/uploads\//, "");
      const absPath = resolve(uploadsDir, rel);
      if ((absPath === uploadsDir || absPath.startsWith(uploadsDir + sep)) && existsSync(absPath)) {
        try {
          if (statSync(absPath).isFile()) {
            const buf = readFileSync(absPath);
            return createHash("sha256").update(buf).digest("hex");
          }
        } catch {}
      }
      return createHash("sha256").update(`url:${s}`).digest("hex");
    }

    return createHash("sha256").update(`url:${s}`).digest("hex");
  }

  if (typeof photo === "object" && photo !== null) {
    const p = photo as Record<string, unknown>;
    const imgData = typeof p.imageData === "string" ? p.imageData : (typeof p.image_data === "string" ? p.image_data : "");
    if (imgData) {
      return hashPhotoContent(imgData);
    }
    if (typeof p.file_hash === "string" && /^[a-f0-9]{64}$/i.test(p.file_hash.trim())) {
      return p.file_hash.trim().toLowerCase();
    }
    const url = typeof p.imageUrl === "string" ? p.imageUrl : (typeof p.image_url === "string" ? p.image_url : "");
    if (url) {
      return hashPhotoContent(url);
    }
  }

  return "";
}

export function extractOrderedPhotoHashes(input: ServePayloadInput): string[] {
  const photoList: Array<{ position: number; hash: string }> = [];

  if (Array.isArray(input.photos) && input.photos.length > 0) {
    input.photos.forEach((p, index) => {
      const pos = typeof (p as any)?.position === "number" ? (p as any).position : index + 1;
      // Mirror the server's persistence rule: positions 1..5 are stored, anything
      // beyond is dropped on write. Hashing photos that are never saved made a
      // client replay of the same stop hash differently and 409 as a false conflict.
      if (pos < 1 || pos > 5) return;
      const h = hashPhotoContent(p);
      if (h) {
        photoList.push({ position: pos, hash: h });
      }
    });
  } else {
    const singleData = input.imageData || input.image_data || input.imageUrl || input.image_url;
    if (singleData) {
      const h = hashPhotoContent(singleData);
      if (h) {
        photoList.push({ position: 1, hash: h });
      }
    }
  }

  // Sort photos by position ascending, then tiebreak by hash
  photoList.sort((a, b) => (a.position !== b.position ? a.position - b.position : a.hash.localeCompare(b.hash)));
  return photoList.map((p) => p.hash);
}

export function computeCanonicalPayload(input: ServePayloadInput): Record<string, unknown> {
  const photoHashes = extractOrderedPhotoHashes(input);
  return {
    accepted_by: String(input.accepted_by || input.acceptedBy || "").trim(),
    accuracy_meters: normalizeAccuracyMeters(input.accuracy_meters ?? input.accuracyMeters),
    address: String(input.service_address || input.serviceAddress || input.address || "").trim(),
    attempt_type: String(input.attempt_type || input.attemptType || "physical").trim().toLowerCase(),
    case_id: String(input.case_id || input.caseId || "").trim(),
    contact_person: String(input.contact_person ?? input.contactPerson ?? "").trim(),
    coordinates: normalizeCoordinates(input.coordinates),
    entity_name: String(input.entity_name || input.entityName || input.corporate_agent || input.corporateAgent || "").trim(),
    event_id: String(input.event_id || input.eventId || "").trim(),
    gps_source: String(input.gps_source ?? input.gpsSource ?? "").trim().toLowerCase(),
    is_manual: normalizeBoolean(input.is_manual ?? input.isManual),
    notes: String(input.notes || "").trim(),
    occurred_at: normalizeOccurredAt(input.occurred_at || input.occurredAt || input.timestamp),
    person_being_served: String(input.person_being_served || input.personBeingServed || input.person || "").trim(),
    photo_hashes: photoHashes,
    physical_description: String(input.physical_description ?? input.physicalDescription ?? "").trim(),
    posting_location: String(input.posting_location || input.postingLocation || "").trim(),
    recipient_id: String(input.recipient_id || input.recipientId || "").trim(),
    recipient_title: String(input.recipient_title || input.recipientTitle || "").trim(),
    refused_to_identify: normalizeBoolean(input.refused_to_identify ?? input.refusedToIdentify),
    result_detail: String(input.result_detail ?? input.resultDetail ?? "").trim(),
    service_method: String(input.service_method || input.serviceMethod || "").trim().toLowerCase(),
    status: String(input.status || "unknown").trim().toLowerCase(),
  };
}

export function computePayloadFingerprint(input: ServePayloadInput): string {
  const canonical = computeCanonicalPayload(input);
  const keys = Object.keys(canonical).sort();
  const sortedCanonical: Record<string, unknown> = {};
  for (const k of keys) {
    sortedCanonical[k] = canonical[k];
  }
  return createHash("sha256").update(JSON.stringify(sortedCanonical)).digest("hex");
}

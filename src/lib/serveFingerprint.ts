/**
 * Canonical Serve Fingerprint Module (Browser and Node/Bun safe).
 * Must remain 100% equivalent to backend server/serveFingerprint.ts (commit 27deb59).
 * - Identical 23 fields and aliases
 * - Coordinate normalization (toFixed(6))
 * - Occurred at ISO date normalization
 * - Accuracy meters and boolean flags
 * - Ordered actual photo byte hashes (SHA-256)
 * - Excludes client stable id
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

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

export function sha256Hex(input: string | Uint8Array): string {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const l = data.length;
  const totalBits = l * 8;

  const remainder = (l + 9) % 64;
  const padLen = remainder === 0 ? 0 : 64 - remainder;
  const totalLen = l + 1 + padLen + 8;
  const padded = new Uint8Array(totalLen);
  padded.set(data);
  padded[l] = 0x80;

  const view = new DataView(padded.buffer);
  const highBits = Math.floor(totalBits / 0x100000000);
  const lowBits = totalBits >>> 0;
  view.setUint32(totalLen - 8, highBits, false);
  view.setUint32(totalLen - 4, lowBits, false);

  let h0 = 0x6a09e667,
    h1 = 0xbb67ae85,
    h2 = 0x3c6ef372,
    h3 = 0xa54ff53a,
    h4 = 0x510e527f,
    h5 = 0x9b05688c,
    h6 = 0x1f83d9ab,
    h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 =
        ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^
        ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^
        (w[i - 15] >>> 3);
      const s1 =
        ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^
        ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^
        (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4,
      f = h5,
      g = h6,
      h = h7;

    for (let i = 0; i < 64; i++) {
      const s1 =
        ((e >>> 6) | (e << 26)) ^
        ((e >>> 11) | (e << 21)) ^
        ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 =
        ((a >>> 2) | (a << 30)) ^
        ((a >>> 13) | (a << 19)) ^
        ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const toHex = (n: number) => n.toString(16).padStart(8, "0");
  return `${toHex(h0)}${toHex(h1)}${toHex(h2)}${toHex(h3)}${toHex(h4)}${toHex(h5)}${toHex(h6)}${toHex(h7)}`;
}

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(clean, "base64"));
  }
  if (typeof atob === "function") {
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return new TextEncoder().encode(clean);
}

function isStrictBase64(s: string): boolean {
  if (!s || s.length < 16) return false;
  if (
    s.startsWith("/") ||
    s.startsWith("http://") ||
    s.startsWith("https://") ||
    s.startsWith(".") ||
    s.includes("?") ||
    s.includes("&")
  ) {
    return false;
  }
  const clean = s.replace(/\s+/g, "");
  if (clean.length < 16 || clean.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(clean);
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

export function hashPhotoContent(photo: unknown): string {
  if (!photo) return "";
  if (typeof photo === "string") {
    const s = photo.trim();
    if (s.startsWith("data:")) {
      const b64 = s.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, "").replace(/\s+/g, "");
      try {
        const buf = decodeBase64(b64);
        return sha256Hex(buf);
      } catch {
        return sha256Hex(s);
      }
    }

    if (isStrictBase64(s)) {
      try {
        const clean = s.replace(/\s+/g, "");
        const buf = decodeBase64(clean);
        return sha256Hex(buf);
      } catch {
        // Fallback
      }
    }

    if (s.startsWith("/uploads/") || s.startsWith("http://") || s.startsWith("https://")) {
      return sha256Hex(`url:${s}`);
    }

    return sha256Hex(`url:${s}`);
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
      // MUST mirror the server (server/serveFingerprint.ts) exactly: only positions
      // 1..5 are persisted, so only those are hashed. Hashing extras here made a
      // 6-photo stop fingerprint differently on each side -> false 409 id_conflict
      // and a serve stuck as "conflict" in the phone outbox.
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
  return sha256Hex(JSON.stringify(sortedCanonical));
}

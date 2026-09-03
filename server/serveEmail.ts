/**
 * Serve attempt notification email — photo LINKS + Maps (no Photo-1-only attachment).
 */

export function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function resolvePublicBase(fallbackHost?: string): string {
  const fromEnv = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const host = fallbackHost || "servetracker-beta-sillyhippy.zocomputer.io";
  return `https://${host.replace(/^https?:\/\//, "")}`;
}

function parseCoords(coordinates: unknown): { lat: number; lng: number } | null {
  if (!coordinates) return null;
  if (typeof coordinates === "object" && coordinates !== null) {
    const o = coordinates as { latitude?: number; longitude?: number; lat?: number; lng?: number };
    const lat = Number(o.latitude ?? o.lat);
    const lng = Number(o.longitude ?? o.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  const s = String(coordinates).trim();
  // "lat,lng" or JSON
  if (s.startsWith("{")) {
    try {
      return parseCoords(JSON.parse(s));
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

export interface ServeEmailInput {
  personBeingServed?: string;
  caseNumber?: string;
  caseName?: string;
  status?: string;
  attemptType?: string;
  serviceMethod?: string;
  acceptedBy?: string;
  entityName?: string;
  recipientTitle?: string;
  postingLocation?: string;
  occurredAt?: string;
  serviceAddress?: string;
  address?: string;
  contactPerson?: string;
  notes?: string;
  gpsSource?: string;
  coordinates?: unknown;
  photos?: Array<{
    image_url?: string;
    imageUrl?: string;
    position?: number;
    captured_at?: string;
    capturedAt?: string;
    label?: string;
    coordinates?: unknown;
  }>;
  /** Attempt-level GPS used when a photo has no own coordinates */
  publicBase: string;
}

function methodLabel(method?: string): string {
  if (!method) return "";
  const m = method.toLowerCase().trim();
  if (m === "personal") return "Personal Service";
  if (m === "substituted-residence") return "Substitute (Residence)";
  if (m === "substituted-business") return "Substitute (Business)";
  if (m === "corporate") return "Corporate / Registered Agent";
  if (m === "posting") return "Posting";
  if (m === "non-service") return "Non-Service";
  return method;
}

export function buildServeNotificationHtml(input: ServeEmailInput): string {
  const isServed = String(input.status || "").toLowerCase() === "completed" || String(input.status || "").toLowerCase() === "served";
  const statusText = isServed ? "SERVICE COMPLETE" : String(input.status || "ATTEMPT").toUpperCase();
  const occurredText = input.occurredAt
    ? new Date(String(input.occurredAt)).toLocaleString("en-US", { timeZone: "America/Chicago" })
    : new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });

  const coords = parseCoords(input.coordinates);
  const mapsUrl = coords
    ? `https://www.google.com/maps?q=${coords.lat},${coords.lng}`
    : "";

  const photoList = Array.isArray(input.photos) ? input.photos : [];
  const base = input.publicBase.replace(/\/$/, "");

  const photoLinksHtml =
    photoList.length > 0
      ? `
            <div style="margin-bottom:20px;padding:16px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;">
              <h4 style="margin:0 0 10px 0;color:#0f172a;">Attempt Photos (${photoList.length})</h4>
              <ol style="margin:0;padding-left:18px;">
                ${photoList
                  .map((p, idx) => {
                    const pos = Number(p.position) || idx + 1;
                    const rel = String(p.image_url || p.imageUrl || "").trim();
                    const captured = p.captured_at || p.capturedAt || input.occurredAt || "";
                    const when = captured
                      ? new Date(String(captured)).toLocaleString("en-US", {
                          timeZone: "America/Chicago",
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "";
                    const photoCoords = parseCoords(p.coordinates) || coords;
                    const gps =
                      photoCoords != null
                        ? `${photoCoords.lat.toFixed(6)}, ${photoCoords.lng.toFixed(6)}`
                        : "";
                    const caption = [p.label || `ServeTracker Photo ${pos}`, when ? `${when} CT` : "", gps]
                      .filter(Boolean)
                      .join(" · ");
                    if (!rel) {
                      return `<li style="margin:0 0 6px 0;color:#94a3b8;">${escapeHtml(caption)}</li>`;
                    }
                    const abs = rel.startsWith("http")
                      ? rel
                      : `${base}${rel.startsWith("/") ? "" : "/"}${rel}`;
                    return `<li style="margin:0 0 8px 0;"><a href="${escapeHtml(abs)}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;font-weight:600;">${escapeHtml(caption)}</a></li>`;
                  })
                  .join("")}
              </ol>
            </div>
          `
      : `
            <div style="margin-bottom:20px;padding:12px;background:#fff7ed;border-radius:6px;border:1px solid #fed7aa;">
              <p style="margin:0;font-size:13px;color:#9a3412;">No attempt photos were saved with this log.</p>
            </div>
          `;

  const mapsHtml = mapsUrl
    ? `<p style="margin:8px 0 0 0;"><a href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;">View GPS on Google Maps</a>${
        coords ? ` <span style="color:#64748b;font-size:12px;">(${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)})</span>` : ""
      }</p>`
    : "";

  return `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:8px;padding:24px;background:#ffffff;">
            <div style="background:#1e293b;color:#ffffff;padding:16px;border-radius:6px;margin-bottom:20px;">
              <h2 style="margin:0;font-size:20px;">${escapeHtml(statusText)}</h2>
              <p style="margin:4px 0 0 0;font-size:14px;color:#94a3b8;">Process Server Notification · Just Legal Solutions</p>
            </div>

            <div style="margin-bottom:20px;padding:16px;background:#f8fafc;border-radius:6px;">
              <p style="margin:0 0 8px 0;"><strong>Recipient / Serving:</strong> <span style="font-size:16px;color:#0f172a;font-weight:bold;">${escapeHtml(input.personBeingServed) || "N/A"}</span></p>
              ${input.entityName ? `<p style="margin:0 0 8px 0;"><strong>Entity Served:</strong> <strong>${escapeHtml(input.entityName)}</strong></p>` : ""}
              ${input.acceptedBy ? `<p style="margin:0 0 8px 0;"><strong>Accepted By:</strong> <span style="color:#0f172a;font-weight:bold;">${escapeHtml(input.acceptedBy)}${input.recipientTitle ? ` (${escapeHtml(input.recipientTitle)})` : ""}</span></p>` : ""}
              ${input.serviceMethod ? `<p style="margin:0 0 8px 0;"><strong>Method of Service:</strong> ${escapeHtml(methodLabel(input.serviceMethod))}</p>` : ""}
              ${input.postingLocation ? `<p style="margin:0 0 8px 0;"><strong>Posting Location:</strong> ${escapeHtml(input.postingLocation)}</p>` : ""}
              <p style="margin:0 0 8px 0;"><strong>Case Number:</strong> ${escapeHtml(input.caseNumber)}</p>
              <p style="margin:0 0 8px 0;"><strong>Person / Matter:</strong> ${escapeHtml(input.caseName)}</p>
              <p style="margin:0 0 8px 0;"><strong>Date & Time:</strong> ${escapeHtml(occurredText)} CT</p>
              <p style="margin:0 0 8px 0;"><strong>Service Address:</strong> ${escapeHtml(input.serviceAddress) || escapeHtml(input.address) || "N/A"}</p>
              ${input.contactPerson ? `<p style="margin:0 0 8px 0;"><strong>Person Contacted:</strong> ${escapeHtml(input.contactPerson)}</p>` : ""}
              ${input.gpsSource === "captured" && coords ? `<p style="margin:0;"><strong>GPS:</strong> Hardware verified</p>${mapsHtml}` : mapsHtml}
            </div>

            ${
              input.notes
                ? `
              <div style="margin-bottom:20px;padding:16px;border-left:4px solid #3b82f6;background:#eff6ff;">
                <h4 style="margin:0 0 8px 0;color:#1e40af;">Attempt Notes</h4>
                <p style="margin:0;color:#1e3a8a;white-space:pre-wrap;">${escapeHtml(input.notes)}</p>
              </div>
            `
                : ""
            }

            ${photoLinksHtml}

            <div style="font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:16px;margin-top:24px;">
              Just Legal Solutions · Process Serving
            </div>
          </div>
        `;
}

export function buildServeEmailSubject(input: { personBeingServed?: string; caseName?: string; caseNumber?: string; status?: string }): string {
  const isServed = String(input.status || "").toLowerCase() === "completed" || String(input.status || "").toLowerCase() === "served";
  const prefix = isServed ? "Service Complete" : "Attempted Serve";
  const who = input.personBeingServed || input.caseName || "Serve Attempt";
  const caseNum = input.caseNumber || "";
  return `${prefix} — ${who}${caseNum ? ` — ${caseNum}` : ""}`;
}

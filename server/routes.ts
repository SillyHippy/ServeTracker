import type { Context } from "hono";
import { randomUUID, createHash } from "crypto";
import { writeFile, unlink, mkdir } from "fs/promises";
import { join, dirname } from "path";
import type { Db } from "./db";
import { UPLOADS_DIR } from "./db";
import { sendEmail } from "./email";
import {
  createHelcimInvoice,
  persistInvoiceOnCase,
  maybeEmailInvoice,
  applyPaidWebhook,
  fetchHelcimInvoice,
  findCaseByInvoiceId,
  attachInvoiceOnCase,
  buildAttachPreview,
} from "./helcim";
import {
  buildServeEmailSubject,
  buildServeNotificationHtml,
  escapeHtml as escapeHtmlServe,
  resolvePublicBase,
} from "./serveEmail";
import { uploadSuccessfulServeToDrive } from "./driveUpload";
import { stampServeTrackerPhoto, parseLatLng } from "./photoStamp";
import { getAuthUser, registerUserRoutes, type AuthUser } from "./auth";
import { registerSignatureRoutes, SIGNATURES_DIR } from "./signatures";
import {
  activeExecution,
  activeSignature,
  buildSourceSnapshot,
  canonicalize,
  computeLicenseStatus,
  createExecution,
  invalidateExecutionsForCase,
  invalidateForServerChanges,
  latestExecution,
  loadCaseBundle,
  methodBlockingError,
  inferAffidavitKind,
  latestSuccessfulServe,
  ATTEMPTS_FOR_CASE_SQL,
  attemptsForCaseParams,
  attemptBelongsToCaseSql,
  newId as exeNewId,
  nowIso as exeNowIso,
  renderExecutionHtml,
  resolveCase,
  resolveTargetRecipient,
  serverEligibilityError,
  sha256Hex,
  validateSignable,
} from "./affidavitExecution";

function newId() {
  return randomUUID().replace(/-/g, "");
}

function nowIso() {
  return new Date().toISOString();
}

/** Validate a target server can be assigned (active + onboarded; expired license blocked).
 *  Missing license is allowed so work can be handed out; affidavit e-sign still requires a license.
 *  Admins (Joseph) can take their own jobs — onboarding/license gates apply to field servers only. */
function validateAssignTarget(db: Db, serverId: string): string | null {
  const u = db.query("SELECT * FROM users WHERE id = ?").get(serverId) as Record<string, unknown> | null;
  if (!u) return "Server not found";
  if (String(u.is_active) !== "1" && u.is_active !== 1) return "Server is deactivated";
  if (String(u.role || "") === "admin") return null;
  if (String(u.onboarding_status || "") !== "active") return "Server onboarding is not complete";
  const lic = computeLicenseStatus(u.license_number, u.license_jurisdiction, u.license_expires_at);
  if (lic === "expired") return "Server license is expired";
  return null;
}

/** Write assignment + event row; void signed affidavits when the assignee changes. */
function applyAssignment(
  db: Db,
  caseId: string,
  newServerId: string,
  actorUserId: string,
  note: string
): { assigned_to: string; assigned_name: string } {
  const current = db.query("SELECT assigned_to FROM client_cases WHERE id = ?").get(caseId) as
    | { assigned_to?: string }
    | null;
  const prev = String(current?.assigned_to || "");

  let name = "";
  if (newServerId) {
    const u = db
      .query("SELECT display_name, legal_name FROM users WHERE id = ?")
      .get(newServerId) as { display_name?: string; legal_name?: string } | null;
    name = String(u?.legal_name || u?.display_name || "");
  }

  db.query("UPDATE client_cases SET assigned_to = ?, assigned_name = ?, updated_at = ? WHERE id = ?").run(
    newServerId,
    name,
    nowIso(),
    caseId
  );
  db.query(
    `INSERT INTO case_assignment_events (id, case_id, previous_server_id, new_server_id, actor_user_id, occurred_at, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(exeNewId(), caseId, prev, newServerId, actorUserId, nowIso(), note);

  if (prev !== newServerId) {
    invalidateExecutionsForCase(db, caseId, newServerId ? "server_changed" : "unassigned");
    
    // Targeted Push Alert on Assignment
    if (newServerId) {
      const caseRow = db.query("SELECT case_number, defendant_respondent, case_name FROM client_cases WHERE id = ?").get(caseId) as Record<string, unknown> | null;
      const caseNum = String(caseRow?.case_number || "New Case");
      const person = String(caseRow?.defendant_respondent || caseRow?.case_name || "");
      import("./notifications").then(({ createNotification }) => {
        createNotification(db, {
          userId: newServerId,
          type: "case_assigned",
          priority: "normal",
          title: `New Case Assigned: ${caseNum}`,
          body: person ? `Assigned to serve ${person}. Tap to view directives.` : "Tap to view case papers and directives.",
          entityType: "case",
          entityId: caseId,
          actionUrl: `/dashboard?caseId=${caseId}`,
        }).catch(() => {});
      });
    }
  }

  return { assigned_to: newServerId, assigned_name: name };
}

function getUserOrAdmin(c: Context): AuthUser {
  return (
    getAuthUser(c) || {
      id: "",
      username: "",
      displayName: "",
      role: "unauthorized" as any,
    }
  );
}

/** Rough device-family detection from a User-Agent string (stored per push subscription). */
function detectPlatform(ua: string): string {
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/windows/i.test(ua)) return "windows";
  if (/mac os/i.test(ua)) return "macos";
  if (/linux/i.test(ua)) return "linux";
  return "unknown";
}

function escapeHtml(str: unknown): string {
  return escapeHtmlServe(str);
}


/** Peer scope for attempt numbering: recipient first, else the immutable case UUID.
 * The case number is a court identifier, not a job identifier: a re-serve may
 * legitimately reuse it and must begin at Attempt 1. */
function attemptPeerWhere(opts: {
  recipientId?: string | null;
  caseId?: string | null;
  clientId?: string | null;
  caseNumber?: string | null;
  personBeingServed?: string | null;
}): { sql: string; params: string[] } {
  const recipientId = String(opts.recipientId || "").trim();
  if (recipientId) {
    return { sql: "recipient_id = ?", params: [recipientId] };
  }
  const caseId = String(opts.caseId || "").trim();
  if (caseId) {
    return { sql: "case_id = ?", params: [caseId] };
  }
  // Legacy rows without a case UUID retain the narrowest available fallback.
  return {
    sql: "client_id = ? AND case_number = ? AND COALESCE(person_being_served, '') = ?",
    params: [
      String(opts.clientId || ""),
      String(opts.caseNumber || ""),
      String(opts.personBeingServed || "").trim(),
    ],
  };
}

/** Resequence attempt_number 1..N by occurred_at for peers in the same job. */
function renumberAttemptPeers(
  db: Db,
  opts: {
    recipientId?: string | null;
    caseId?: string | null;
    clientId?: string | null;
    caseNumber?: string | null;
    personBeingServed?: string | null;
  }
) {
  const { sql, params } = attemptPeerWhere(opts);
  const peers = db
    .query(
      `SELECT id FROM serve_attempts WHERE ${sql} ORDER BY COALESCE(occurred_at, timestamp) ASC, id ASC`
    )
    .all(...params) as { id: string }[];
  let n = 1;
  for (const peer of peers) {
    db.query("UPDATE serve_attempts SET attempt_number = ? WHERE id = ?").run(n, peer.id);
    n++;
  }
  return peers.length;
}

/** Close exactly one case row by UUID on successful personal service. */
function maybeCloseCaseOnSuccess(db: Db, caseId: string | null | undefined, status: string) {
  const id = String(caseId || "").trim();
  if (!id) return false;
  const s = String(status || "").toLowerCase().trim();
  if (s !== "completed" && s !== "served") return false;
  db.query("UPDATE client_cases SET status = ?, updated_at = ? WHERE id = ?").run("closed", nowIso(), id);
  return true;
}

function publicBaseUrl(c: Context): string {
  const host =
    c.req.header("x-forwarded-host") ||
    c.req.header("host") ||
    "servetracker-beta-sillyhippy.zocomputer.io";
  return resolvePublicBase(host);
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clientRow(row: Record<string, unknown>) {
  return {
    $id: row.id,
    id: row.id,
    name: row.name,
    email: row.email,
    additional_emails: parseJsonArray(row.additional_emails as string),
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    latest_activity: row.latest_activity || row.last_case_at || null,
    last_case_at: row.latest_activity || row.last_case_at || null,
  };
}

function caseRow(row: Record<string, unknown>, role: "admin" | "server" = "server") {
  if (role === "server") {
    return {
      $id: row.id,
      id: row.id,
      client_id: "",
      client_name: "",
      case_number: row.case_number,
      case_name: row.case_name,
      court_name: row.court_name,
      plaintiff_petitioner: row.plaintiff_petitioner,
      defendant_respondent: row.defendant_respondent,
      home_address: row.home_address,
      work_address: row.work_address,
      documents_to_serve: row.documents_to_serve || "",
      notes: row.notes,
      service_requirements: row.service_requirements || "",
      contact_info: row.contact_info || "",
      status: row.status,
      assigned_to: row.assigned_to || "",
      assigned_name: row.assigned_name || "",
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
  return {
    $id: row.id,
    id: row.id,
    client_id: row.client_id,
    case_number: row.case_number,
    case_name: row.case_name,
    court_name: row.court_name,
    plaintiff_petitioner: row.plaintiff_petitioner,
    defendant_respondent: row.defendant_respondent,
    home_address: row.home_address,
    work_address: row.work_address,
    documents_to_serve: row.documents_to_serve || "",
    notes: row.notes,
    service_requirements: row.service_requirements || "",
    contact_info: row.contact_info || "",
    status: row.status,
    assigned_to: row.assigned_to || "",
    assigned_name: row.assigned_name || "",
    quoted_fee: row.quoted_fee || "",
    invoice_id: row.invoice_id || "",
    invoice_number: row.invoice_number || "",
    pay_url: row.pay_url || "",
    payment_status: row.payment_status || "",
    paid_at: row.paid_at || "",
    payment_method: row.payment_method || "",
    payment_notes: row.payment_notes || "",
    invoice_email_sent: row.invoice_email_sent || 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function recipientRow(row: Record<string, unknown>, role: "admin" | "server" = "server") {
  const out: Record<string, unknown> = {
    $id: row.id,
    id: row.id,
    case_id: row.case_id,
    full_name: row.full_name,
    role: row.role || "",
    description: row.description || "",
    status: row.status || "Pending",
    home_address: row.home_address || "",
    work_address: row.work_address || "",
    notes: row.notes || "",
    assigned_to: row.assigned_to || "",
    assigned_name: row.assigned_name || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (role === "admin") {
    out.client_id = row.client_id;
  }
  return out;
}

function serveRow(row: Record<string, unknown>, db?: Db, role: "admin" | "server" = "server") {
  let coordinates: unknown = row.coordinates;
  if (typeof coordinates === "string") {
    if (coordinates.startsWith("{")) {
      try {
        const parsed = JSON.parse(coordinates);
        if (parsed.latitude !== undefined && parsed.longitude !== undefined) {
          coordinates = parsed;
        }
      } catch {
        // Not valid JSON
      }
    }
    if (typeof coordinates === "string" && coordinates.includes(",")) {
      const [lat, lng] = coordinates.split(",").map((v) => parseFloat(v.trim()));
      if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
        coordinates = { latitude: lat, longitude: lng };
      }
    }
  }

  let photos: Record<string, unknown>[] = [];
  if (db) {
    photos = db
      .query("SELECT * FROM serve_attempt_photos WHERE serve_id = ? ORDER BY position ASC")
      .all(row.id as string) as Record<string, unknown>[];
  }

  let edits: Record<string, unknown>[] = [];
  if (db) {
    edits = db
      .query("SELECT * FROM serve_attempt_edits WHERE serve_id = ? ORDER BY edited_at DESC")
      .all(row.id as string) as Record<string, unknown>[];
  }

  // Resolve the client's email so update/edit notifications can reach the client
  // (the serve_attempts table has no email column; it lives on the clients table).
  let clientEmail = "";
  if (role !== "server" && db && row.client_id) {
    const clientRowDb = db
      .query("SELECT email FROM clients WHERE id = ?")
      .get(row.client_id as string) as { email: string } | null;
    clientEmail = clientRowDb?.email || "";
  }

  return {
    id: row.id,
    $id: row.id,
    clientId: role === "server" ? "" : row.client_id,
    client_id: role === "server" ? "" : row.client_id,
    caseId: row.case_id || "",
    case_id: row.case_id || "",
    clientName: role === "server" ? "" : row.client_name,
    client_name: role === "server" ? "" : row.client_name,
    clientEmail: role === "server" ? "" : clientEmail,
    client_email: role === "server" ? "" : clientEmail,
    caseNumber: row.case_number,
    case_number: row.case_number,
    caseName: row.case_name,
    case_name: row.case_name,
    eventId: row.event_id || row.id,
    event_id: row.event_id || row.id,
    recipientId: row.recipient_id || "",
    recipient_id: row.recipient_id || "",
    personBeingServed: row.person_being_served || "",
    person_being_served: row.person_being_served || "",
    status: row.status,
    notes: row.notes,
    address: row.address,
    serviceAddress: row.service_address,
    service_address: row.service_address,
    coordinates,
    imageUrl: row.image_url,
    image_url: row.image_url,
    imageFileId: row.image_file_id,
    image_file_id: row.image_file_id,
    thumbnailUrl: row.thumbnail_url,
    thumbnail_url: row.thumbnail_url,
    thumbnailFileId: row.thumbnail_file_id,
    thumbnail_file_id: row.thumbnail_file_id,
    image_data: row.image_data,
    timestamp: row.timestamp ? new Date(row.timestamp as string) : new Date(),
    occurredAt: row.occurred_at || row.timestamp,
    occurred_at: row.occurred_at || row.timestamp,
    enteredAt: row.entered_at || row.timestamp,
    entered_at: row.entered_at || row.timestamp,
    attemptNumber: row.attempt_number,
    attempt_number: row.attempt_number,
    attemptType: row.attempt_type || "physical",
    attempt_type: row.attempt_type || "physical",
    gpsSource: row.gps_source || (coordinates ? "captured" : "none"),
    gps_source: row.gps_source || (coordinates ? "captured" : "none"),
    contactPerson: row.contact_person || "",
    contact_person: row.contact_person || "",
    isManual: Boolean(row.is_manual),
    is_manual: Boolean(row.is_manual),
    resultDetail: row.result_detail || "",
    result_detail: row.result_detail || "",
    physicalDescription: row.physical_description || "",
    physical_description: row.physical_description || "",
    serviceMethod: (row.service_method as string) || "",
    service_method: (row.service_method as string) || "",
    postingLocation: (row.posting_location as string) || "",
    posting_location: (row.posting_location as string) || "",
    entityName: (row.entity_name as string) || "",
    entity_name: (row.entity_name as string) || "",
    corporateAgent: (row.entity_name as string) || "",
    corporate_agent: (row.entity_name as string) || "",
    recipientTitle: (row.recipient_title as string) || "",
    recipient_title: (row.recipient_title as string) || "",
    attemptHash: row.attempt_hash || "",
    attempt_hash: row.attempt_hash || "",
    accuracyMeters: Number(row.accuracy_meters || 0),
    accuracy_meters: Number(row.accuracy_meters || 0),
    deviceInfo: row.device_info || "",
    device_info: row.device_info || "",
    acceptedBy: row.accepted_by || "",
    accepted_by: row.accepted_by || "",
    loggedBy: row.logged_by || "",
    logged_by: row.logged_by || "",
    loggedByName: row.logged_by_name || "",
    logged_by_name: row.logged_by_name || "",
    photos: photos.map((p) => ({
      id: p.id,
      position: p.position,
      imageUrl: p.image_url,
      image_url: p.image_url,
      thumbnailUrl: p.thumbnail_url,
      thumbnail_url: p.thumbnail_url,
      mimeType: p.mime_type,
      width: p.width,
      height: p.height,
      fileSize: p.file_size,
      capturedAt: p.captured_at || p.created_at || "",
      captured_at: p.captured_at || p.created_at || "",
      label: p.label || `ServeTracker Photo ${p.position}`,
      coordinates: p.coordinates || "",
    })),
    edits: role === "server" ? [] : edits.map((e) => ({
      id: e.id,
      editedAt: e.edited_at,
      editedBy: e.edited_by,
      oldNotes: e.old_notes,
      newNotes: e.new_notes,
      oldStatus: e.old_status,
      newStatus: e.new_status,
    })),
  };
}

function documentRow(row: Record<string, unknown>) {
  return {
    $id: row.id,
    id: row.id,
    clientId: row.client_id,
    client_id: row.client_id,
    caseId: row.case_id || "",
    case_id: row.case_id || "",
    caseNumber: row.case_number || "",
    case_number: row.case_number || "",
    fileName: row.file_name,
    file_name: row.file_name,
    fileSize: row.file_size,
    file_size: row.file_size,
    fileType: row.file_type,
    file_type: row.file_type,
    filePath: row.file_path,
    file_path: row.file_path,
    fileHash: row.file_hash || "",
    file_hash: row.file_hash || "",
    description: row.description,
    createdAt: row.created_at,
    created_at: row.created_at,
  };
}

async function saveBase64Image(
  base64Data: string,
  destPath: string,
  stamp?: { capturedAt?: string; latitude?: number | null; longitude?: number | null; position?: number; address?: string | null }
) {
  let pure = base64Data;
  if (base64Data.includes("base64,")) {
    pure = base64Data.split("base64,")[1];
  }
  const buffer = Buffer.from(pure, "base64");
  await mkdir(dirname(destPath), { recursive: true });
  await writeFile(destPath, buffer);
  // Strip device EXIF and write ServeTracker court-friendly metadata
  stampServeTrackerPhoto(destPath, {
    capturedAt: stamp?.capturedAt || nowIso(),
    latitude: stamp?.latitude,
    longitude: stamp?.longitude,
    position: stamp?.position,
    address: stamp?.address,
  });
}

export function registerRoutes(app: { get: Function; post: Function; put: Function; delete: Function; patch: Function }, db: Db) {
  registerUserRoutes(app, db);
  registerSignatureRoutes(app, db);
  app.get("/api/health", (c: Context) => {
    const count = db.query("SELECT COUNT(*) as count FROM clients").get() as { count: number };
    return c.json({ ok: true, clients: count.count });
  });

  // User Consent Endpoint (ToS, DPA, Privacy Policy acceptance)
  app.post("/api/auth/consent", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (!user?.id) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const body = await c.req.json().catch(() => ({}));
    const documentType = String(body.document_type || body.documentType || "").trim().toLowerCase();
    const version = String(body.version || "2026.1").trim();

    if (!documentType || !["tos", "privacy", "dpa"].includes(documentType)) {
      return c.json({ error: "Valid document_type ('tos', 'privacy', 'dpa') is required" }, 400);
    }

    const now = nowIso();
    const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "127.0.0.1";
    const userAgent = c.req.header("user-agent") || "";
    const id = "cs_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);

    db.query(`
      INSERT INTO user_consents (id, user_id, document_type, version, accepted_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, user.id, documentType, version, now, ip, userAgent);

    if (documentType === "tos") {
      db.query("UPDATE users SET tos_accepted_at = ?, tos_version = ?, tos_ip = ? WHERE id = ?").run(now, version, ip, user.id);
    } else if (documentType === "dpa") {
      db.query("UPDATE users SET dpa_accepted_at = ?, dpa_version = ? WHERE id = ?").run(now, version, user.id);
    }

    logAuditEvent(db, {
      event_type: "legal.consent_accepted",
      actor_user_id: user.id,
      actor_role: user.role,
      ip_address: ip,
      user_agent: userAgent,
      details: { document_type: documentType, version }
    });

    return c.json({ success: true, document_type: documentType, version, accepted_at: now });
  });

  // GET /api/compliance/status - check current user consent status
  app.get("/api/compliance/status", (c: Context) => {
    const user = getUserOrAdmin(c);
    if (!user?.id) return c.json({ error: "Unauthorized" }, 401);

    const userRow = db.query("SELECT tos_accepted_at, tos_version, dpa_accepted_at, dpa_version FROM users WHERE id = ?").get(user.id) as {
      tos_accepted_at?: string;
      tos_version?: string;
      dpa_accepted_at?: string;
      dpa_version?: string;
    } | null;

    return c.json({
      tos_accepted: Boolean(userRow?.tos_accepted_at),
      tos_version: userRow?.tos_version || "",
      tos_accepted_at: userRow?.tos_accepted_at || "",
      dpa_accepted: Boolean(userRow?.dpa_accepted_at),
      dpa_version: userRow?.dpa_version || "",
      dpa_accepted_at: userRow?.dpa_accepted_at || "",
    });
  });

  // GET /api/compliance/audit-logs - Admin only audit log inspection
  app.get("/api/compliance/audit-logs", (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const limit = Math.min(Number(c.req.query("limit") || 100), 500);
    const logs = db.query("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?").all(limit);
    return c.json({ logs });
  });

  // Global Search
  app.get("/api/search", (c: Context) => {
    const user = getUserOrAdmin(c);
    const q = (c.req.query("q") || "").trim();
    if (!q) {
      return c.json({ recipients: [], cases: [], clients: [], serves: [] });
    }
    const param = `%${q}%`;

    if (user.role === "server") {
      const assignedCases = db
        .query(
          "SELECT * FROM client_cases WHERE (assigned_to = ? OR assigned_to = ?) AND (case_number LIKE ? OR case_name LIKE ? OR plaintiff_petitioner LIKE ? OR defendant_respondent LIKE ?) LIMIT 20"
        )
        .all(user.id, user.username, param, param, param, param) as Record<string, unknown>[];

      const recipients = db
        .query(
          `SELECT r.* FROM serve_recipients r
           JOIN client_cases c ON r.case_id = c.id
           WHERE (c.assigned_to = ? OR c.assigned_to = ?) AND (r.full_name LIKE ? OR r.description LIKE ?) LIMIT 20`
        )
        .all(user.id, user.username, param, param) as Record<string, unknown>[];

      const serves = db
        .query(
          `SELECT s.* FROM serve_attempts s
           WHERE (s.logged_by = ? OR s.case_number IN (SELECT case_number FROM client_cases WHERE assigned_to = ? OR assigned_to = ?))
             AND (s.person_being_served LIKE ? OR s.notes LIKE ? OR s.case_number LIKE ?) LIMIT 20`
        )
        .all(user.id, user.id, user.username, param, param, param) as Record<string, unknown>[];

      return c.json({
        recipients: recipients.map((r) => recipientRow(r, "server")),
        cases: assignedCases.map((cs) => caseRow(cs, "server")),
        clients: [],
        serves: serves.map((r) => serveRow(r, db, "server")),
      });
    }

    const recipients = db.query("SELECT * FROM serve_recipients WHERE full_name LIKE ? OR description LIKE ? LIMIT 20").all(param, param) as Record<string, unknown>[];
    const cases = db.query("SELECT * FROM client_cases WHERE case_number LIKE ? OR case_name LIKE ? OR plaintiff_petitioner LIKE ? OR defendant_respondent LIKE ? LIMIT 20").all(param, param, param, param) as Record<string, unknown>[];
    const clients = db.query("SELECT * FROM clients WHERE name LIKE ? OR email LIKE ? OR phone LIKE ? LIMIT 20").all(param, param, param) as Record<string, unknown>[];
    const serves = db.query("SELECT * FROM serve_attempts WHERE person_being_served LIKE ? OR notes LIKE ? OR case_number LIKE ? LIMIT 20").all(param, param, param) as Record<string, unknown>[];

    return c.json({
      recipients: recipients.map((r) => recipientRow(r, "admin")),
      cases: cases.map((cs) => caseRow(cs, "admin")),
      clients: clients.map(clientRow),
      serves: serves.map((r) => serveRow(r, db, "admin")),
    });
  });

  // Clients
  app.get("/api/clients", (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role === "server") {
      return c.json([]);
    }
    // Most recent case or serve attempt first (Joe: Campbell Law Offices with a new job jumps to #1).
    // Clients with no cases sort below anyone who has case activity.
    const rows = db.query(`
      SELECT c.*, MAX(COALESCE(sub.act_time, '')) AS latest_activity
      FROM clients c
      LEFT JOIN (
        SELECT client_id, MAX(COALESCE(updated_at, created_at)) AS act_time
        FROM client_cases
        GROUP BY client_id
        UNION ALL
        SELECT client_id, MAX(COALESCE(occurred_at, timestamp)) AS act_time
        FROM serve_attempts
        GROUP BY client_id
      ) sub ON sub.client_id = c.id
      GROUP BY c.id
      ORDER BY
        CASE WHEN latest_activity IS NULL OR latest_activity = '' THEN 1 ELSE 0 END,
        latest_activity DESC,
        c.name ASC
    `).all() as Record<string, unknown>[];
    return c.json(rows.map(clientRow));
  });

  app.post("/api/clients", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const body = await c.req.json();
    const id = body.id || newId();
    const createdAt = nowIso();
    db.query(
      `INSERT INTO clients (id, name, email, additional_emails, phone, address, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      body.name,
      body.email || "",
      JSON.stringify(body.additionalEmails || body.additional_emails || []),
      body.phone || "",
      body.address || "",
      body.notes || "",
      createdAt,
      createdAt
    );
    const row = db.query("SELECT * FROM clients WHERE id = ?").get(id) as Record<string, unknown>;
    logAuditEvent(db, {
      event_type: "client.create",
      actor_user_id: user.id,
      actor_role: user.role,
      target_resource_id: id,
      ip_address: c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "",
      user_agent: c.req.header("user-agent") || "",
      details: { name: body.name },
    });
    return c.json(clientRow(row), 201);
  });

  app.put("/api/clients/:id", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const id = c.req.param("id");
    const body = await c.req.json();
    const existing = db.query("SELECT * FROM clients WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!existing) {
      return c.json({ error: "Client not found" }, 404);
    }
    // Merge: only update provided fields, keep existing for omitted ones
    const name = body.name !== undefined ? body.name : existing.name;
    const email = body.email !== undefined ? body.email : existing.email;
    const additional = body.additionalEmails !== undefined || body.additional_emails !== undefined
      ? JSON.stringify(body.additionalEmails || body.additional_emails || [])
      : existing.additional_emails;
    const phone = body.phone !== undefined ? body.phone : existing.phone;
    const address = body.address !== undefined ? body.address : existing.address;
    const notes = body.notes !== undefined ? body.notes : existing.notes;
    db.query(
      `UPDATE clients SET name = ?, email = ?, additional_emails = ?, phone = ?, address = ?, notes = ?, updated_at = ? WHERE id = ?`
    ).run(
      name ?? "", email ?? "", additional ?? "[]", phone ?? "", address ?? "", notes ?? "", nowIso(), id
    );
    const row = db.query("SELECT * FROM clients WHERE id = ?").get(id) as Record<string, unknown>;
    logAuditEvent(db, {
      event_type: "client.update",
      actor_user_id: user.id,
      actor_role: user.role,
      target_resource_id: id,
      ip_address: c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "",
      user_agent: c.req.header("user-agent") || "",
    });
    return c.json(clientRow(row));
  });

  app.delete("/api/clients/:id", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const id = c.req.param("id");
    const existing = db.query("SELECT id FROM clients WHERE id = ?").get(id) as { id: string } | null;
    if (!existing) {
      return c.json({ error: "Client not found" }, 404);
    }

    // Cascade: recipients → photos/edits → serves → cases → documents → client
    db.query("DELETE FROM serve_recipients WHERE client_id = ?").run(id);

    const serves = db.query("SELECT id, image_file_id, thumbnail_file_id FROM serve_attempts WHERE client_id = ?").all(id) as {
      id: string;
      image_file_id: string;
      thumbnail_file_id: string;
    }[];
    for (const serve of serves) {
      const photos = db.query("SELECT image_url, thumbnail_url FROM serve_attempt_photos WHERE serve_id = ?").all(serve.id) as {
        image_url?: string;
        thumbnail_url?: string;
      }[];
      for (const photo of photos) {
        await deleteServeFiles(photo.image_url, photo.thumbnail_url);
      }
      db.query("DELETE FROM serve_attempt_photos WHERE serve_id = ?").run(serve.id);
      db.query("DELETE FROM serve_attempt_edits WHERE serve_id = ?").run(serve.id);
      await deleteServeFiles(serve.image_file_id, serve.thumbnail_file_id);
      db.query("DELETE FROM serve_attempts WHERE id = ?").run(serve.id);
    }

    db.query("DELETE FROM client_cases WHERE client_id = ?").run(id);

    const docs = db.query("SELECT id, file_path FROM client_documents WHERE client_id = ?").all(id) as {
      id: string;
      file_path: string;
    }[];
    for (const doc of docs) {
      await deleteDocumentFile(doc.file_path);
      db.query("DELETE FROM client_documents WHERE id = ?").run(doc.id);
    }

    db.query("DELETE FROM clients WHERE id = ?").run(id);
    logAuditEvent(db, {
      event_type: "client.delete",
      actor_user_id: user.id,
      actor_role: user.role,
      target_resource_id: id,
      ip_address: c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "",
      user_agent: c.req.header("user-agent") || "",
    });
    return c.json({ success: true });
  });

  // Cases
  app.get("/api/cases", (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role === "server") {
      const rows = db
        .query("SELECT * FROM client_cases WHERE (assigned_to = ? OR assigned_to = ?) ORDER BY created_at DESC")
        .all(user.id, user.username) as Record<string, unknown>[];
      return c.json(rows.map((r) => caseRow(r, "server")));
    }

    const clientId = c.req.query("client_id");
    const rows = clientId !== undefined && clientId !== ""
      ? (db.query("SELECT * FROM client_cases WHERE client_id = ? ORDER BY created_at DESC").all(clientId) as Record<string, unknown>[])
      : (db.query("SELECT * FROM client_cases ORDER BY created_at DESC").all() as Record<string, unknown>[]);
    return c.json(rows.map((r) => caseRow(r, "admin")));
  });

  app.get("/api/cases/:id", (c: Context) => {
    const user = getUserOrAdmin(c);
    const id = c.req.param("id");
    const caseObj = resolveCase(db, id);
    if (!caseObj) return c.json({ error: "Case not found" }, 404);
    if (user.role === "server" && String(caseObj.assigned_to || "") !== user.id && String(caseObj.assigned_to || "") !== user.username) {
      return c.json({ error: "Forbidden: Not assigned to this case" }, 403);
    }
    const row = db.query("SELECT * FROM client_cases WHERE id = ?").get(caseObj.id) as Record<string, unknown>;
    return c.json(caseRow(row, user.role));
  });

  app.post("/api/cases", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const body = await c.req.json();
    const ts = nowIso();
    
    // Same case # can intentionally have multiple jobs/people (e.g. 17 addresses).
    // Only reuse an existing row when explicitly requested.
    const reuseExisting = body.reuse_existing === true || body.reuseExisting === true;
    const existing = reuseExisting
      ? (db.query(
          "SELECT id FROM client_cases WHERE client_id = ? AND case_number = ? AND case_number != ''"
        ).get(body.client_id, body.case_number) as { id: string } | null)
      : null;

    let id = body.id || newId();
    const assignedTo = body.assigned_to || body.assignedTo || "";
    let assignedName = body.assigned_name || body.assignedName || "";
    if (assignedTo && !assignedName) {
      const srvUser = db.query("SELECT display_name, legal_name, username FROM users WHERE id = ? OR username = ?").get(assignedTo, assignedTo) as { display_name?: string; legal_name?: string; username?: string } | null;
      if (srvUser) {
        assignedName = srvUser.display_name || srvUser.legal_name || srvUser.username || "";
      }
    }

    if (existing) {
      id = existing.id;
    } else {
      db.query(
        `INSERT INTO client_cases (id, client_id, case_number, case_name, court_name, plaintiff_petitioner, defendant_respondent, home_address, work_address, documents_to_serve, notes, service_requirements, contact_info, status, assigned_to, assigned_name, quoted_fee, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        body.client_id,
        body.case_number,
        body.case_name || "",
        body.court_name || "",
        body.plaintiff_petitioner || "",
        body.defendant_respondent || "",
        body.home_address || "",
        body.work_address || "",
        body.documents_to_serve || body.documents || "",
        body.notes || "",
        body.service_requirements || body.requirements || "",
        body.contact_info || body.contactInfo || "",
        body.status || "Open",
        assignedTo,
        assignedName,
        body.quoted_fee ? String(body.quoted_fee) : "",
        ts,
        ts
      );
      // Touch client record so latest_activity updates instantly
      db.query("UPDATE clients SET updated_at = ? WHERE id = ?").run(ts, body.client_id);

      const attachInvoiceId = String(
        body.attach_invoice_id || body.attachInvoiceId || body.invoice_id || "",
      ).trim();
      const attachInvoiceNumber = String(
        body.attach_invoice_number || body.attachInvoiceNumber || body.invoice_number || "",
      ).trim();
      if (body.create_invoice && (attachInvoiceId || attachInvoiceNumber)) {
        return c.json({
          error: "Use create_invoice OR attach_invoice_id, not both",
        }, 400);
      }

      if (body.create_invoice && body.quoted_fee) {
        const cl = db.query("SELECT * FROM clients WHERE id = ?").get(body.client_id) as Record<string, unknown> | null;
        if (cl && cl.email) {
          try {
            const inv = await createHelcimInvoice({
              caseNumber: body.case_number,
              customerName: String(cl.company_name || cl.contact_name || cl.name || "Client"),
              customerEmail: String(cl.email),
              amount: Number(body.quoted_fee),
              notes: body.notes || "",
            });
            persistInvoiceOnCase(db, id, inv, Number(body.quoted_fee));
            if (body.email_invoice) {
              await maybeEmailInvoice({
                to: String(cl.email),
                caseNumber: body.case_number,
                amount: Number(body.quoted_fee),
                payUrl: inv.payUrl,
                clientName: String(cl.contact_name || cl.company_name || cl.name || "Client"),
              });
            }
          } catch (err) {
            console.error("Auto invoice creation failed on case create:", err);
          }
        }
      } else if (attachInvoiceId || attachInvoiceNumber) {
        try {
          const invoice = await fetchHelcimInvoice({
            invoiceId: attachInvoiceId,
            invoiceNumber: attachInvoiceNumber,
          });
          if (invoice.status === "CANCELLED") {
            return c.json({ error: "Cannot attach a cancelled Helcim invoice" }, 400);
          }
          const conflictCaseId = findCaseByInvoiceId(db, invoice.invoiceId, id);
          if (conflictCaseId) {
            return c.json({
              error: "Invoice already attached to another case",
              conflictCaseId,
            }, 409);
          }
          const quotedFee = Number(body.quoted_fee || invoice.amount || 0);
          if (!quotedFee || quotedFee <= 0) {
            return c.json({ error: "quoted_fee must be a positive number for invoice attach" }, 400);
          }
          attachInvoiceOnCase(db, id, invoice, quotedFee);
        } catch (err: any) {
          console.error("Attach invoice on case create failed:", err);
          return c.json({ error: err.message || "Failed to attach invoice on case create" }, 500);
        }
      }
    }

    // Auto-create or sync serve_recipients if recipients list or defendant_respondent provided
    if (Array.isArray(body.recipients) && body.recipients.length > 0) {
      for (const rec of body.recipients) {
        const name = typeof rec === "string" ? rec.trim() : String(rec?.full_name || rec?.name || "").trim();
        if (!name) continue;
        const role = (typeof rec === "object" && rec?.role) ? String(rec.role).trim() : "Defendant / Respondent";
        const home = (typeof rec === "object" && rec?.home_address) ? String(rec.home_address).trim() : (body.home_address || "");
        const work = (typeof rec === "object" && rec?.work_address) ? String(rec.work_address).trim() : (body.work_address || "");
        const existingRec = db.query("SELECT id FROM serve_recipients WHERE case_id = ? AND LOWER(full_name) = LOWER(?)").get(id, name);
        if (!existingRec) {
          db.query(
            `INSERT INTO serve_recipients (id, case_id, client_id, full_name, role, home_address, work_address, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            "rec_" + newId().slice(0, 16),
            id,
            body.client_id,
            name,
            role,
            home,
            work,
            ts,
            ts
          );
        }
      }
    } else if (body.defendant_respondent && body.defendant_respondent.trim()) {
      const recId = "rec_" + id.slice(0, 16);
      const existingRec = db.query("SELECT id FROM serve_recipients WHERE case_id = ? AND full_name = ?").get(id, body.defendant_respondent.trim());
      if (!existingRec) {
        db.query(
          `INSERT INTO serve_recipients (id, case_id, client_id, full_name, role, home_address, work_address, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          recId,
          id,
          body.client_id,
          body.defendant_respondent.trim(),
          "Defendant / Respondent",
          body.home_address || "",
          body.work_address || "",
          ts,
          ts
        );
      }
    }

    if (body.client_id) {
      db.query("UPDATE clients SET updated_at = ? WHERE id = ?").run(ts, body.client_id);
    }

    const row = db.query("SELECT * FROM client_cases WHERE id = ?").get(id) as Record<string, unknown>;
    logAuditEvent(db, {
      event_type: existing ? "case.update" : "case.create",
      actor_user_id: user.id,
      actor_role: user.role,
      target_resource_id: id,
      ip_address: c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "",
      user_agent: c.req.header("user-agent") || "",
      details: { case_number: body.case_number },
    });
    return c.json(caseRow(row, user.role === "admin" ? "admin" : "server"), existing ? 200 : 201);
  });

  // Case status update (used to open/close cases)
  app.patch("/api/cases/:id/status", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (!user?.id) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const id = c.req.param("id");
    const body = await c.req.json();
    const existing = db.query("SELECT id, assigned_to FROM client_cases WHERE id = ?").get(id) as { id: string; assigned_to?: string } | null;
    if (!existing) {
      return c.json({ error: "Case not found" }, 404);
    }
    if (user.role === "server") {
      const isAssigned = existing.assigned_to === user.id || existing.assigned_to === user.username;
      if (!isAssigned) {
        return c.json({ error: "Forbidden: Not assigned to this case" }, 403);
      }
    }
    const status = String(body.status || "active").trim();
    db.query("UPDATE client_cases SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), id);
    invalidateExecutionsForCase(db, id, "material_change");
    const row = db.query("SELECT * FROM client_cases WHERE id = ?").get(id) as Record<string, unknown>;
    return c.json(caseRow(row, user.role));
  });

  app.put("/api/cases/:id", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const id = c.req.param("id");
    const body = await c.req.json();
    const ts = nowIso();
    const existing = db.query("SELECT * FROM client_cases WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!existing) {
      return c.json({ error: "Case not found" }, 404);
    }
    // Merge: only update provided fields, keep existing for omitted ones
    const caseNumber = body.case_number !== undefined ? body.case_number : existing.case_number;
    const caseName = body.case_name !== undefined ? body.case_name : existing.case_name;
    const courtName = body.court_name !== undefined ? body.court_name : existing.court_name;
    const plaintiff = body.plaintiff_petitioner !== undefined ? body.plaintiff_petitioner : existing.plaintiff_petitioner;
    const defendant = body.defendant_respondent !== undefined ? body.defendant_respondent : existing.defendant_respondent;
    const homeAddress = body.home_address !== undefined ? body.home_address : existing.home_address;
    const workAddress = body.work_address !== undefined ? body.work_address : existing.work_address;
    const documents =
      body.documents_to_serve !== undefined || body.documents !== undefined
        ? body.documents_to_serve || body.documents || ""
        : existing.documents_to_serve;
    const notes = body.notes !== undefined ? body.notes : existing.notes;
    const requirements =
      body.service_requirements !== undefined || body.requirements !== undefined
        ? body.service_requirements || body.requirements || ""
        : existing.service_requirements;
    const contactInfo =
      body.contact_info !== undefined || body.contactInfo !== undefined
        ? body.contact_info || body.contactInfo || ""
        : existing.contact_info;
    const status = body.status !== undefined ? body.status : existing.status;
    const assignedTo = body.assigned_to !== undefined || body.assignedTo !== undefined
      ? String(body.assigned_to || body.assignedTo || "").trim()
      : (existing.assigned_to as string || "");
    const assignedName = body.assigned_name !== undefined || body.assignedName !== undefined
      ? String(body.assigned_name || body.assignedName || "").trim()
      : (existing.assigned_name as string || "");

    // Assignment goes through the SAME validation helper as /api/admin/cases/:id/assign.
    if (body.assigned_to !== undefined || body.assignedTo !== undefined) {
      if (assignedTo) {
        const assignErr = validateAssignTarget(db, assignedTo);
        if (assignErr) {
          return c.json({ error: assignErr }, 400);
        }
      }
    }

    db.query(
      `UPDATE client_cases SET case_number = ?, case_name = ?, court_name = ?, plaintiff_petitioner = ?, defendant_respondent = ?, home_address = ?, work_address = ?, documents_to_serve = ?, notes = ?, service_requirements = ?, contact_info = ?, status = ?, assigned_to = ?, assigned_name = ?, updated_at = ? WHERE id = ?`
    ).run(
      caseNumber ?? "", caseName ?? "", courtName ?? "", plaintiff ?? "", defendant ?? "",
      homeAddress ?? "", workAddress ?? "", documents ?? "", notes ?? "", requirements ?? "", contactInfo ?? "", status ?? "Open", assignedTo ?? "", assignedName ?? "", ts, id
    );

    // Record assignment events + void signed affidavits when assignment changed.
    if (body.assigned_to !== undefined || body.assignedTo !== undefined) {
      if (String(existing.assigned_to || "") !== assignedTo) {
        applyAssignment(db, id, assignedTo, user.id, assignedTo ? "assigned" : "unassigned");
      }
    }

    // Any material case-field edit voids the latest signed execution.
    const materialChanged =
      (caseNumber !== undefined && String(caseNumber) !== String(existing.case_number || "")) ||
      (caseName !== undefined && String(caseName) !== String(existing.case_name || "")) ||
      (courtName !== undefined && String(courtName) !== String(existing.court_name || "")) ||
      (plaintiff !== undefined && String(plaintiff) !== String(existing.plaintiff_petitioner || "")) ||
      (defendant !== undefined && String(defendant) !== String(existing.defendant_respondent || "")) ||
      (homeAddress !== undefined && String(homeAddress) !== String(existing.home_address || "")) ||
      (workAddress !== undefined && String(workAddress) !== String(existing.work_address || "")) ||
      (documents !== undefined && String(documents) !== String(existing.documents_to_serve || "")) ||
      (status !== undefined && String(status) !== String(existing.status || ""));
    if (materialChanged) {
      invalidateExecutionsForCase(db, id, "material_change");
    }

    if (Array.isArray(body.recipients) && body.recipients.length > 0) {
      for (const rec of body.recipients) {
        const name = typeof rec === "string" ? rec.trim() : String(rec?.full_name || rec?.name || "").trim();
        if (!name) continue;
        const role = (typeof rec === "object" && rec?.role) ? String(rec.role).trim() : "Defendant / Respondent";
        const home = (typeof rec === "object" && rec?.home_address) ? String(rec.home_address).trim() : (homeAddress || "");
        const work = (typeof rec === "object" && rec?.work_address) ? String(rec.work_address).trim() : (workAddress || "");
        const existingRec = db.query("SELECT id FROM serve_recipients WHERE case_id = ? AND LOWER(full_name) = LOWER(?)").get(id, name);
        if (!existingRec) {
          const caseObj = db.query("SELECT client_id FROM client_cases WHERE id = ?").get(id) as { client_id: string };
          db.query(
            `INSERT INTO serve_recipients (id, case_id, client_id, full_name, role, home_address, work_address, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            "rec_" + newId().slice(0, 16),
            id,
            caseObj.client_id,
            name,
            role,
            home,
            work,
            ts,
            ts
          );
        }
      }
    } else if (body.defendant_respondent && body.defendant_respondent.trim()) {
      const existingRec = db.query("SELECT id FROM serve_recipients WHERE case_id = ? AND full_name = ?").get(id, body.defendant_respondent.trim());
      if (!existingRec) {
        const caseObj = db.query("SELECT client_id FROM client_cases WHERE id = ?").get(id) as { client_id: string };
        db.query(
          `INSERT INTO serve_recipients (id, case_id, client_id, full_name, role, home_address, work_address, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          "rec_" + newId().slice(0, 16),
          id,
          caseObj.client_id,
          body.defendant_respondent.trim(),
          "Defendant / Respondent",
          body.home_address || "",
          body.work_address || "",
          ts,
          ts
        );
      }
    }

    const row = db.query("SELECT * FROM client_cases WHERE id = ?").get(id) as Record<string, unknown>;
    return c.json(caseRow(row));
  });

  app.delete("/api/cases/:id", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const id = c.req.param("id");
    db.query("DELETE FROM affidavit_executions WHERE case_id = ?").run(id);
    db.query("DELETE FROM case_assignment_events WHERE case_id = ?").run(id);
    db.query("DELETE FROM serve_recipients WHERE case_id = ?").run(id);
    db.query("DELETE FROM client_cases WHERE id = ?").run(id);
    logAuditEvent(db, {
      event_type: "case.delete",
      actor_user_id: user.id,
      actor_role: user.role,
      target_resource_id: id,
      ip_address: c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "",
      user_agent: c.req.header("user-agent") || "",
    });
    return c.json({ success: true });
  });

  // Recipients (Person Being Served)
  app.get("/api/recipients", (c: Context) => {
    const user = getUserOrAdmin(c);
    const caseId = c.req.query("case_id");
    const clientId = c.req.query("client_id");
    let rows: Record<string, unknown>[];

    if (user.role === "server") {
      if (!caseId) {
        return c.json({ error: "Forbidden: case_id query parameter required" }, 403);
      }
      rows = db
        .query(
          `SELECT r.* FROM serve_recipients r
           JOIN client_cases c ON r.case_id = c.id
           WHERE r.case_id = ? AND (c.assigned_to = ? OR c.assigned_to = ?)
           ORDER BY r.full_name ASC`
        )
        .all(caseId, user.id, user.username) as Record<string, unknown>[];
      return c.json(rows.map((r) => recipientRow(r, "server")));
    }

    if (caseId) {
      rows = db.query("SELECT * FROM serve_recipients WHERE case_id = ? ORDER BY full_name ASC").all(caseId) as Record<string, unknown>[];
    } else if (clientId) {
      rows = db.query("SELECT * FROM serve_recipients WHERE client_id = ? ORDER BY full_name ASC").all(clientId) as Record<string, unknown>[];
    } else {
      rows = db.query("SELECT * FROM serve_recipients ORDER BY full_name ASC").all() as Record<string, unknown>[];
    }
    return c.json(rows.map((r) => recipientRow(r, "admin")));
  });

  app.post("/api/recipients", async (c: Context) => {
    const user = getUserOrAdmin(c);
    const body = await c.req.json();
    const caseId = String(body.case_id || body.caseId || "");
    if (!caseId) {
      return c.json({ error: "case_id is required" }, 400);
    }
    const caseObj = db.query("SELECT * FROM client_cases WHERE id = ?").get(caseId) as Record<string, unknown> | null;
    if (!caseObj) {
      return c.json({ error: "Case not found" }, 404);
    }
    if (user.role === "server") {
      const isAssigned = caseObj.assigned_to === user.id || caseObj.assigned_to === user.username;
      if (!isAssigned) {
        return c.json({ error: "Forbidden: Not assigned to this case" }, 403);
      }
    }

    const id = body.id || newId();
    const ts = nowIso();
    db.query(
      `INSERT INTO serve_recipients (id, case_id, client_id, full_name, role, description, status, home_address, work_address, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      caseId,
      caseObj.client_id,
      body.full_name,
      body.role || "",
      body.description || "",
      body.status || "Pending",
      body.home_address || "",
      body.work_address || "",
      body.notes || "",
      ts,
      ts
    );
    invalidateExecutionsForCase(db, caseId, "material_change");
    const row = db.query("SELECT * FROM serve_recipients WHERE id = ?").get(id) as Record<string, unknown>;
    return c.json(recipientRow(row, user.role), 201);
  });

  app.put("/api/recipients/:id", async (c: Context) => {
    const user = getUserOrAdmin(c);
    const id = c.req.param("id");
    const body = await c.req.json();
    const ts = nowIso();
    const existing = db.query("SELECT * FROM serve_recipients WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!existing) {
      return c.json({ error: "Recipient not found" }, 404);
    }
    if (user.role === "server" && existing.case_id) {
      const caseObj = db.query("SELECT assigned_to FROM client_cases WHERE id = ?").get(existing.case_id) as { assigned_to?: string } | null;
      const isAssigned = caseObj && (caseObj.assigned_to === user.id || caseObj.assigned_to === user.username);
      if (!isAssigned) {
        return c.json({ error: "Forbidden: Not assigned to this case" }, 403);
      }
    }
    // Merge: only update provided fields, keep existing for omitted ones
    const fullName = body.full_name !== undefined ? body.full_name : existing.full_name;
    const role = body.role !== undefined ? body.role : existing.role;
    const description = body.description !== undefined ? body.description : existing.description;
    const status = body.status !== undefined ? body.status : existing.status;
    const homeAddress = body.home_address !== undefined ? body.home_address : existing.home_address;
    const workAddress = body.work_address !== undefined ? body.work_address : existing.work_address;
    const notes = body.notes !== undefined ? body.notes : existing.notes;
    db.query(
      `UPDATE serve_recipients SET full_name = ?, role = ?, description = ?, status = ?, home_address = ?, work_address = ?, notes = ?, updated_at = ? WHERE id = ?`
    ).run(
      fullName ?? "", role ?? "", description ?? "", status ?? "Pending",
      homeAddress ?? "", workAddress ?? "", notes ?? "", ts, id
    );

    // Recipient facts appear on the affidavit → void any signed execution.
    if (existing.case_id) {
      invalidateExecutionsForCase(db, String(existing.case_id), "material_change");
    }

    const row = db.query("SELECT * FROM serve_recipients WHERE id = ?").get(id) as Record<string, unknown>;
    return c.json(recipientRow(row, user.role));
  });

  app.delete("/api/recipients/:id", (c: Context) => {
    const user = getUserOrAdmin(c);
    const id = c.req.param("id");
    const existing = db.query("SELECT * FROM serve_recipients WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!existing) {
      return c.json({ error: "Recipient not found" }, 404);
    }
    if (user.role === "server" && existing.case_id) {
      const caseObj = db.query("SELECT assigned_to FROM client_cases WHERE id = ?").get(existing.case_id) as { assigned_to?: string } | null;
      const isAssigned = caseObj && (caseObj.assigned_to === user.id || caseObj.assigned_to === user.username);
      if (!isAssigned) {
        return c.json({ error: "Forbidden: Not assigned to this case" }, 403);
      }
    }
    if (existing.case_id) {
      invalidateExecutionsForCase(db, String(existing.case_id), "material_change");
    }
    db.query("DELETE FROM serve_recipients WHERE id = ?").run(id);
    return c.json({ success: true });
  });

  // Serve Attempts Count
  app.get("/api/serves/count", (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role === "server") {
      return c.json({ error: "Forbidden: Global serve count is admin-only" }, 403);
    }
    const row = db.query("SELECT COUNT(*) as total FROM serve_attempts").get() as { total: number };
    return c.json({ total: row ? row.total : 0 });
  });

  // Serve Attempts
  app.get("/api/serves", (c: Context) => {
    const user = getUserOrAdmin(c);
    const clientId = c.req.query("client_id");
    const caseNumber = c.req.query("case_number");
    const caseId = c.req.query("case_id");
    const recipientId = c.req.query("recipient_id");
    const rawLimit = Number(c.req.query("limit") || 500);
    const rawOffset = Number(c.req.query("offset") || 0);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 500;
    const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

    if (user.role === "server") {
      // Never match other clients solely by case_number (PG-26-22 exists on two jobs).
      let sql = `
        SELECT s.* FROM serve_attempts s
        WHERE (
          s.logged_by = ? OR
          s.case_id IN (SELECT id FROM client_cases WHERE assigned_to = ? OR assigned_to = ?) OR
          EXISTS (
            SELECT 1 FROM client_cases c
            WHERE (c.assigned_to = ? OR c.assigned_to = ?)
              AND c.case_number = s.case_number
              AND c.client_id = s.client_id
          )
        )
      `;
      const conditions: string[] = [];
      const params: (string | number)[] = [user.id, user.id, user.username, user.id, user.username];

      if (caseNumber) {
        conditions.push("s.case_number = ?");
        params.push(caseNumber);
      }
      if (recipientId) {
        conditions.push("s.recipient_id = ?");
        params.push(recipientId);
      }
      if (caseId) {
        conditions.push(attemptBelongsToCaseSql("s."));
        params.push(caseId, caseId, caseId, caseId);
      }

      if (conditions.length > 0) {
        sql += " AND " + conditions.join(" AND ");
      }
      sql += " ORDER BY COALESCE(s.occurred_at, s.timestamp) DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);

      const rows = db.query(sql).all(...params) as Record<string, unknown>[];
      return c.json(rows.map((r) => serveRow(r, db, "server")));
    }

    let sql = "SELECT * FROM serve_attempts";
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (clientId) {
      conditions.push("client_id = ?");
      params.push(clientId);
    }
    if (caseNumber) {
      conditions.push("case_number = ?");
      params.push(caseNumber);
    }
    if (recipientId) {
      conditions.push("recipient_id = ?");
      params.push(recipientId);
    }
    if (caseId) {
      conditions.push(attemptBelongsToCaseSql());
      params.push(caseId, caseId, caseId, caseId);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }
    sql += " ORDER BY COALESCE(occurred_at, timestamp) DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const rows = db.query(sql).all(...params) as Record<string, unknown>[];
    return c.json(rows.map((r) => serveRow(r, db, "admin")));
  });

  app.post("/api/serves", async (c: Context) => {
    const user = getUserOrAdmin(c);
    const body = await c.req.json();
    const id = body.id || newId();

    const existingById = db.query("SELECT * FROM serve_attempts WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (existingById) {
      return c.json(serveRow(existingById, db, user.role === "server" ? "server" : "admin"));
    }

    let coordinates = "";
    if (body.coordinates) {
      if (typeof body.coordinates === "string") {
        coordinates = body.coordinates;
      } else if (typeof body.coordinates === "object") {
        coordinates = JSON.stringify(body.coordinates);
      }
    }

    const caseNum = body.caseNumber || body.case_number || "";
    const recipientIdEarly = String(body.recipientId || body.recipient_id || "").trim();
    const personBeingServedEarly = String(body.personBeingServed || body.person_being_served || "").trim();
    let caseId = String(body.caseId || body.case_id || "").trim();

    let clientId = body.clientId || body.client_id || "";
    let clientName = body.clientName || body.client_name || "";

    // If submitted by server or clientId omitted, resolve clientId from case or recipient
    if (!clientId && caseId) {
      const caseRecord = db.query("SELECT client_id FROM client_cases WHERE id = ?").get(caseId) as { client_id: string } | null;
      if (caseRecord) {
        clientId = caseRecord.client_id;
      }
    }
    if (!clientId && caseNum) {
      const caseRecord = db.query("SELECT client_id FROM client_cases WHERE case_number = ? ORDER BY updated_at DESC LIMIT 1").get(caseNum) as { client_id: string } | null;
      if (caseRecord) {
        clientId = caseRecord.client_id;
      }
    }
    if (!clientId && recipientIdEarly) {
      const recRecord = db.query("SELECT client_id, case_id FROM serve_recipients WHERE id = ?").get(recipientIdEarly) as { client_id: string; case_id: string } | null;
      if (recRecord) {
        clientId = recRecord.client_id;
        if (!caseId) caseId = recRecord.case_id;
      }
    }

    if (user.role === "server") {
      const assignedCase = caseId
        ? (db.query("SELECT id FROM client_cases WHERE id = ? AND (assigned_to = ? OR assigned_to = ?)").get(caseId, user.id, user.username) as { id: string } | null)
        : (caseNum
            ? (db.query("SELECT id FROM client_cases WHERE case_number = ? AND (assigned_to = ? OR assigned_to = ?) ORDER BY updated_at DESC LIMIT 1").get(caseNum, user.id, user.username) as { id: string } | null)
            : null);
      if (!assignedCase) {
        return c.json({ error: "Forbidden: you can only log attempts on cases assigned to you" }, 403);
      }
      if (!caseId) caseId = assignedCase.id;
    }

    const clientObj = clientId
      ? (db.query("SELECT name, email, additional_emails FROM clients WHERE id = ?").get(clientId) as {
          name?: string;
          email?: string;
          additional_emails?: string;
        } | null)
      : null;
    if (clientObj?.name) {
      clientName = clientObj.name;
    }
    // Field servers never receive client email (GET /api/clients is empty). Always resolve from the case.
    const resolvedClientEmails: string[] = [];
    const pushEmail = (raw: unknown) => {
      const e = String(raw || "").trim();
      if (e && e.includes("@") && !resolvedClientEmails.some((x) => x.toLowerCase() === e.toLowerCase())) {
        resolvedClientEmails.push(e);
      }
    };
    pushEmail(body.clientEmail || body.client_email);
    pushEmail(clientObj?.email);
    for (const extra of parseJsonArray(clientObj?.additional_emails)) pushEmail(extra);
    if (!caseId && caseNum && clientId) {
      // Prefer active case row for this client+case # when caller omitted UUID
      const activeCase = db.query(
        `SELECT id FROM client_cases WHERE client_id = ? AND case_number = ?
         AND LOWER(COALESCE(status,'')) NOT IN ('closed','completed','served','non-service','nonservice')
         ORDER BY updated_at DESC, created_at DESC LIMIT 1`
      ).get(clientId, caseNum) as { id: string } | null;
      const anyCase = activeCase || (db.query(
        "SELECT id FROM client_cases WHERE client_id = ? AND case_number = ? ORDER BY updated_at DESC LIMIT 1"
      ).get(clientId, caseNum) as { id: string } | null);
      caseId = anyCase?.id || "";
    }
    // Server owns attempt_number — ignore client-provided values
    const attemptNumber = 0; // placeholder; renumberAttemptPeers sets final 1..N after insert

    let imageUrl = body.imageUrl || body.image_url || "";
    let imageFileId = body.imageFileId || body.image_file_id || "";
    let thumbnailUrl = body.thumbnailUrl || body.thumbnail_url || "";
    let thumbnailFileId = body.thumbnailFileId || body.thumbnail_file_id || "";

    const timestamp = body.timestamp || nowIso();
    const occurredAt = body.occurredAt || body.occurred_at || timestamp;
    const enteredAt = nowIso();
    const gpsSource = body.gpsSource || body.gps_source || (coordinates ? "captured" : "none");
    const recipientId = recipientIdEarly;
    const personBeingServed = personBeingServedEarly;
    const attemptType = body.attemptType || body.attempt_type || "physical";
    const contactPerson = body.contactPerson || body.contact_person || "";
    const isManual = body.isManual || body.is_manual ? 1 : 0;
    const resultDetail = body.resultDetail || body.result_detail || "";
    const physicalDescription = body.physicalDescription || body.physical_description || "";
    const serviceAddress = body.serviceAddress || body.service_address || body.address || "";
    const gps = parseLatLng(coordinates || body.coordinates);

    // Save base64 image if provided directly
    if (body.imageData && body.imageData.length > 100) {
      const fileId = newId();
      const filename = `${fileId}_full.jpg`;
      const fullPath = join(UPLOADS_DIR, "serves", filename);
      const capturedAt = body.capturedAt || body.captured_at || enteredAt;
      await saveBase64Image(body.imageData, fullPath, {
        capturedAt,
        latitude: gps?.lat,
        longitude: gps?.lng,
        position: 1,
        address: serviceAddress,
      });
      imageUrl = `/uploads/serves/${filename}`;
      imageFileId = fileId;
      thumbnailUrl = imageUrl;
      thumbnailFileId = fileId;
    }

    const serveStatus = body.status || "unknown";
    const accuracyMeters = Number(body.accuracy_meters || body.accuracyMeters || 0);
    const deviceInfo = String(body.device_info || body.deviceInfo || c.req.header("user-agent") || "").slice(0, 255);
    const attemptHash = createHash("sha256").update(`${id}|${caseNum}|${timestamp}|${coordinates}|${user.id}|${serveStatus}`).digest("hex");
    const postingLocation = String(body.postingLocation || body.posting_location || "");
    const entityName = String(body.entityName || body.entity_name || body.corporateAgent || body.corporate_agent || "");
    const recipientTitle = String(body.recipientTitle || body.recipient_title || "");
    // Siblings of one physical encounter pass the same eventId. Unset means
    // this row is its own encounter, matching the self-event backfill.
    const eventId = String(body.eventId || body.event_id || "").trim() || id;

    db.query(
      `INSERT INTO serve_attempts (
        id, client_id, client_name, case_number, case_name, recipient_id, person_being_served,
        status, notes, address, service_address, coordinates, image_url, image_file_id,
        thumbnail_url, thumbnail_file_id, image_data, timestamp, occurred_at, entered_at,
        attempt_number, attempt_type, gps_source, contact_person, is_manual, result_detail, physical_description, case_id,
        service_method, accepted_by, logged_by, logged_by_name, attempt_hash, accuracy_meters, device_info,
        posting_location, entity_name, recipient_title, event_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      clientId,
      clientName,
      caseNum,
      body.caseName || body.case_name || "",
      recipientId,
      personBeingServed,
      serveStatus,
      body.notes || "",
      body.address || "",
      serviceAddress,
      coordinates,
      imageUrl,
      imageFileId,
      thumbnailUrl,
      thumbnailFileId,
      "", // Stop writing heavy base64 to SQLite column
      timestamp,
      occurredAt,
      enteredAt,
      attemptNumber,
      attemptType,
      gpsSource,
      contactPerson,
      isManual,
      resultDetail,
      physicalDescription,
      caseId,
      body.serviceMethod || body.service_method || "",
      body.acceptedBy || body.accepted_by || "",
      user.id,
      user.displayName || user.username || "",
      attemptHash,
      accuracyMeters,
      deviceInfo,
      postingLocation,
      entityName,
      recipientTitle,
      eventId
    );

    // Assign sequential attempt_number for this person/job (ignore client-supplied number)
    renumberAttemptPeers(db, {
      recipientId,
      caseId,
      clientId,
      caseNumber: caseNum,
      personBeingServed,
    });

    // A new attempt changes affidavit facts → void any signed execution.
    if (caseId) {
      invalidateExecutionsForCase(db, caseId, "material_change");
    }

    // Auto-update case status to 'Served' only for an actual successful serve.
    // The capture form defaults serviceMethod to "personal" even when Result is
    // Unsuccessful (status=failed). Presence of a method is NOT success.
    const statusNorm = String(serveStatus || "").toLowerCase().trim();
    const isUnsuccessful = [
      "failed",
      "unsuccessful",
      "attempted",
      "in progress",
      "in-progress",
      "unknown",
    ].includes(statusNorm);
    const isSuccessful = !isUnsuccessful && (statusNorm === "served" || statusNorm === "completed");
    if (caseId && isSuccessful) {
      db.query("UPDATE client_cases SET status = 'Served', updated_at = ? WHERE id = ?").run(nowIso(), caseId);
    }

    // Save multiple photos if provided in creation POST
    if (Array.isArray(body.photos) && body.photos.length > 0) {
      let pos = 1;
      for (const p of body.photos.slice(0, 5)) {
        let pUrl = p.imageUrl || p.image_url || "";
        let pThumbUrl = p.thumbnailUrl || p.thumbnail_url || pUrl;
        let pFileId = newId();
        const capturedAt = p.capturedAt || p.captured_at || enteredAt;
        const label = `ServeTracker Photo ${pos}`;
        const photoCoords = coordinates || "";

        if (p.imageData && p.imageData.length > 100) {
          const fn = `${id}_p${pos}_full.jpg`;
          const fp = join(UPLOADS_DIR, "serves", fn);
          await saveBase64Image(p.imageData, fp, {
            capturedAt,
            latitude: gps?.lat,
            longitude: gps?.lng,
            position: pos,
            address: serviceAddress,
          });
          pUrl = `/uploads/serves/${fn}`;
          pThumbUrl = pUrl;
        } else if (pUrl && pUrl.startsWith("/uploads/")) {
          // Restamp existing local file if present
          const fp = join(UPLOADS_DIR, "serves", pUrl.split("/").pop()!);
          stampServeTrackerPhoto(fp, {
            capturedAt,
            latitude: gps?.lat,
            longitude: gps?.lng,
            position: pos,
            address: serviceAddress,
          });
        }

        db.query(
          `INSERT INTO serve_attempt_photos (id, serve_id, position, image_url, image_file_id, thumbnail_url, thumbnail_file_id, created_at, captured_at, label, coordinates)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(newId(), id, pos, pUrl, pFileId, pThumbUrl, pFileId, nowIso(), capturedAt, label, photoCoords);

        if (pos === 1 && !imageUrl) {
          db.query("UPDATE serve_attempts SET image_url = ?, thumbnail_url = ? WHERE id = ?").run(pUrl, pThumbUrl, id);
        }
        pos++;
      }
    } else if (imageUrl) {
      // Create position 1 entry in photos table
      db.query(
        `INSERT OR IGNORE INTO serve_attempt_photos (id, serve_id, position, image_url, image_file_id, thumbnail_url, thumbnail_file_id, created_at, captured_at, label, coordinates)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        newId(),
        id,
        1,
        imageUrl,
        imageFileId,
        thumbnailUrl,
        thumbnailFileId,
        nowIso(),
        body.capturedAt || body.captured_at || enteredAt,
        "ServeTracker Photo 1",
        coordinates
      );
    }

    const row = db.query("SELECT * FROM serve_attempts WHERE id = ?").get(id) as Record<string, unknown>;
    const response = serveRow(row, db, user.role);

    // Send email notification if requested — ALWAYS server-built HTML with photo LINKS.
    // Never trust body.emailHtml (old clients sent Maps-only / Photo-1 attachment templates).
    // HARD SAFETY GUARD: Never send email if notes/body indicate a probe, test, or if explicitly blocked.
    const isProbeOrTest =
      body.sendEmail === false ||
      body.isTest === true ||
      body.is_test === true ||
      c.req.header("x-test-probe") === "1" ||
      String(body.notes || "").toLowerCase().includes("probe") ||
      String(body.notes || "").toLowerCase().includes("test");

    if (!isProbeOrTest && resolvedClientEmails.length > 0) {
      try {
        const clientEmail = resolvedClientEmails;
        const base = publicBaseUrl(c);
        const emailHtml = buildServeNotificationHtml({
          personBeingServed: String(response.person_being_served || response.personBeingServed || ""),
          caseNumber: String(response.case_number || response.caseNumber || ""),
          caseName: String(response.case_name || response.caseName || ""),
          status: String(response.status || ""),
          attemptType: String(response.attempt_type || response.attemptType || "physical"),
          serviceMethod: String(response.service_method || response.serviceMethod || ""),
          acceptedBy: String(response.accepted_by || response.acceptedBy || ""),
          entityName: String(response.entity_name || response.entityName || response.corporate_agent || response.corporateAgent || ""),
          recipientTitle: String(response.recipient_title || response.recipientTitle || ""),
          postingLocation: String(response.posting_location || response.postingLocation || ""),
          occurredAt: String(response.occurred_at || response.occurredAt || response.timestamp || ""),
          serviceAddress: String(response.service_address || response.serviceAddress || ""),
          address: String(response.address || ""),
          contactPerson: String(response.contact_person || response.contactPerson || ""),
          notes: String(response.notes || ""),
          gpsSource: String(response.gps_source || response.gpsSource || ""),
          coordinates: response.coordinates,
          photos: Array.isArray(response.photos) ? (response.photos as any[]) : [],
          publicBase: base,
        });
        const emailSubject = buildServeEmailSubject({
          personBeingServed: String(response.person_being_served || ""),
          caseName: String(response.case_name || ""),
          caseNumber: String(response.case_number || ""),
          status: String(response.status || ""),
        });

        await sendEmail({
          to: clientEmail,
          subject: emailSubject,
          html: emailHtml,
          // links only — no attachImage
        });
      } catch (err) {
        console.error("[serve] Failed to send email notification:", err);
      }
    }

    // Optional: on successful personal service, upload photos to Drive case folder
    const statusLower = String(response.status || "").toLowerCase();
    // Default OFF — enable only with DRIVE_UPLOAD_ON_SUCCESS=1|true (hash-verify not fully proven yet)
    const driveUploadEnabled =
      process.env.DRIVE_UPLOAD_ON_SUCCESS === "1" ||
      process.env.DRIVE_UPLOAD_ON_SUCCESS === "true";
    if (
      (statusLower === "completed" || statusLower === "served") &&
      body.uploadToDrive !== false &&
      driveUploadEnabled
    ) {
      try {
        const driveResult = await uploadSuccessfulServeToDrive({
          caseNumber: String(response.case_number || ""),
          serveId: String(response.id || id),
          personBeingServed: String(response.person_being_served || ""),
          photos: Array.isArray(response.photos) ? (response.photos as any[]) : [],
        });
        (response as any).driveUpload = driveResult;
        console.log("[serve] Drive upload:", driveResult);
      } catch (err) {
        console.error("[serve] Drive upload failed (non-fatal):", err);
      }
    }

    // Notify all active Admins of the logged attempt
    import("./notifications").then(({ notifyAdmins }) => {
      const serverName = String(user.displayName || user.username || "Server");
      const caseNum = String(response.case_number || response.caseNumber || "Case");
      const person = String(response.person_being_served || response.personBeingServed || "");
      const statusLabel = String(response.status || "logged");
      notifyAdmins(db, {
        type: statusLabel.toLowerCase() === "served" ? "serve_complete" : "serve_attempt",
        priority: statusLabel.toLowerCase() === "served" ? "high" : "normal",
        title: `Attempt: ${caseNum} (${statusLabel})`,
        body: `${serverName} logged attempt on ${person || caseNum}`,
        entityType: "serve",
        entityId: String(id),
        actionUrl: `/history?case=${caseNum}`,
      }).catch(() => {});
    });

    logAuditEvent(db, {
      event_type: "serve.create",
      actor_user_id: user.id,
      actor_role: user.role,
      target_resource_id: String(id),
      ip_address: c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "",
      user_agent: c.req.header("user-agent") || "",
      details: { case_id: String(response.case_id || response.caseId || ""), case_number: String(response.case_number || "") },
    });

    return c.json(response, 201);
  });

  // Resend link-based notification for an existing attempt (fixes old Maps-only emails)
  app.post("/api/serves/:id/resend-email", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const row = db.query("SELECT * FROM serve_attempts WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!row) return c.json({ error: "Serve attempt not found" }, 404);

    const response = serveRow(row, db);
    const clientRowDb = db.query("SELECT email FROM clients WHERE id = ?").get(row.client_id as string) as
      | { email: string }
      | null;
    const to =
      body.to ||
      body.clientEmail ||
      clientRowDb?.email ||
      "info@justlegalsolutions.org";

    const base = publicBaseUrl(c);
    const emailHtml = buildServeNotificationHtml({
      personBeingServed: String(response.person_being_served || ""),
      caseNumber: String(response.case_number || ""),
      caseName: String(response.case_name || ""),
      status: String(response.status || ""),
      attemptType: String(response.attempt_type || "physical"),
      serviceMethod: String(response.service_method || response.serviceMethod || ""),
      acceptedBy: String(response.accepted_by || response.acceptedBy || ""),
      entityName: String(response.entity_name || response.entityName || response.corporate_agent || response.corporateAgent || ""),
      recipientTitle: String(response.recipient_title || response.recipientTitle || ""),
      postingLocation: String(response.posting_location || response.postingLocation || ""),
      occurredAt: String(response.occurred_at || response.timestamp || ""),
      serviceAddress: String(response.service_address || ""),
      address: String(response.address || ""),
      contactPerson: String(response.contact_person || ""),
      notes: String(response.notes || ""),
      gpsSource: String(response.gps_source || ""),
      coordinates: response.coordinates,
      photos: Array.isArray(response.photos) ? (response.photos as any[]) : [],
      publicBase: base,
    });

    const result = await sendEmail({
      to,
      subject: buildServeEmailSubject({
        personBeingServed: String(response.person_being_served || ""),
        caseName: String(response.case_name || ""),
        caseNumber: String(response.case_number || ""),
        status: String(response.status || ""),
      }),
      html: emailHtml,
    });

    return c.json({
      success: true,
      photoCount: Array.isArray(response.photos) ? response.photos.length : 0,
      publicBase: base,
      ...result,
    });
  });

  // Comprehensive PUT update on serve attempt (With Audit Logging)
  app.put("/api/serves/:id", async (c: Context) => {
    const user = getUserOrAdmin(c);
    const id = c.req.param("id");
    const body = await c.req.json();
    const existing = db.query("SELECT * FROM serve_attempts WHERE id = ?").get(id) as Record<string, unknown> | null;

    if (!existing) {
      return c.json({ error: "Serve attempt not found" }, 404);
    }

    if (user.role === "server") {
      return c.json({ error: "Forbidden: Field servers cannot edit serve attempts" }, 403);
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    // GPS / coordinates are intentionally omitted — original attempt GPS is immutable on edit.
    const fieldMap: Record<string, string> = {
      notes: "notes",
      status: "status",
      caseNumber: "case_number",
      case_number: "case_number",
      caseName: "case_name",
      case_name: "case_name",
      recipientId: "recipient_id",
      recipient_id: "recipient_id",
      personBeingServed: "person_being_served",
      person_being_served: "person_being_served",
      attemptType: "attempt_type",
      attempt_type: "attempt_type",
      occurredAt: "occurred_at",
      occurred_at: "occurred_at",
      contactPerson: "contact_person",
      contact_person: "contact_person",
      isManual: "is_manual",
      is_manual: "is_manual",
      resultDetail: "result_detail",
      result_detail: "result_detail",
      physicalDescription: "physical_description",
      physical_description: "physical_description",
      serviceMethod: "service_method",
      service_method: "service_method",
      acceptedBy: "accepted_by",
      accepted_by: "accepted_by",
      postingLocation: "posting_location",
      posting_location: "posting_location",
      entityName: "entity_name",
      entity_name: "entity_name",
      corporateAgent: "entity_name",
      corporate_agent: "entity_name",
      recipientTitle: "recipient_title",
      recipient_title: "recipient_title",
      address: "address",
      serviceAddress: "service_address",
      service_address: "service_address",
    };

    for (const [key, column] of Object.entries(fieldMap)) {
      if (body[key] !== undefined) {
        updates.push(`${column} = ?`);
        values.push(typeof body[key] === "boolean" ? (body[key] ? 1 : 0) : body[key]);
      }
    }

    if (updates.length > 0) {
      values.push(id);
      db.query(`UPDATE serve_attempts SET ${updates.join(", ")} WHERE id = ?`).run(...values);

      // Audit Log Entry if notes or status changed
      const notesChanged = body.notes !== undefined && String(body.notes) !== String(existing.notes ?? "");
      const statusChanged = body.status !== undefined && String(body.status) !== String(existing.status ?? "");
      if (notesChanged || statusChanged) {
        const newNotes = body.notes !== undefined ? String(body.notes ?? "") : String(existing.notes ?? "");
        const newStatus = body.status !== undefined ? String(body.status ?? "") : String(existing.status ?? "");
        db.query(
          `INSERT INTO serve_attempt_edits (id, serve_id, edited_at, edited_by, old_notes, new_notes, old_status, new_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          newId(),
          id,
          nowIso(),
          "user",
          String(existing.notes ?? ""),
          newNotes,
          String(existing.status ?? ""),
          newStatus
        );
      }
    }

    const row = db.query("SELECT * FROM serve_attempts WHERE id = ?").get(id) as Record<string, unknown>;

    // Renumber if peer scope keys or occurred_at may have changed
    renumberAttemptPeers(db, {
      recipientId: row.recipient_id as string,
      caseId: row.case_id as string,
      clientId: row.client_id as string,
      caseNumber: row.case_number as string,
      personBeingServed: row.person_being_served as string,
    });
    // Cases stay active until an admin closes them. Do not auto-close on successful serve.

    // Material attempt edits void any signed execution for the case.
    if (row.case_id) {
      invalidateExecutionsForCase(db, String(row.case_id), "material_change");
    }

    const refreshed = db.query("SELECT * FROM serve_attempts WHERE id = ?").get(id) as Record<string, unknown>;
    logAuditEvent(db, {
      event_type: "serve.update",
      actor_user_id: user.id,
      actor_role: user.role,
      target_resource_id: id,
      ip_address: c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "",
      user_agent: c.req.header("user-agent") || "",
    });
    return c.json(serveRow(refreshed, db, user.role === "server" ? "server" : "admin"));
  });

  app.delete("/api/serves/:id", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role !== "admin") {
      return c.json({ error: "Forbidden: Field servers cannot delete serve attempts" }, 403);
    }
    const id = c.req.param("id");
    const row = db.query(
      "SELECT image_file_id, thumbnail_file_id, recipient_id, client_id, case_number, person_being_served, case_id FROM serve_attempts WHERE id = ?"
    ).get(id) as {
      image_file_id: string;
      thumbnail_file_id: string;
      recipient_id?: string;
      client_id?: string;
      case_number?: string;
      person_being_served?: string;
      case_id?: string;
    } | null;
    if (!row) {
      return c.json({ error: "Serve attempt not found" }, 404);
    }
    // Deleting an attempt changes affidavit facts → void any signed execution.
    if (row.case_id) {
      invalidateExecutionsForCase(db, row.case_id, "material_change");
    }
    const photos = db.query("SELECT image_url, thumbnail_url FROM serve_attempt_photos WHERE serve_id = ?").all(id) as {
      image_url?: string;
      thumbnail_url?: string;
    }[];
    for (const photo of photos) {
      await deleteServeFiles(photo.image_url, photo.thumbnail_url);
    }
    await deleteServeFiles(row.image_file_id, row.thumbnail_file_id);
    db.query("DELETE FROM serve_attempt_photos WHERE serve_id = ?").run(id);
    db.query("DELETE FROM serve_attempt_edits WHERE serve_id = ?").run(id);
    db.query("DELETE FROM serve_attempts WHERE id = ?").run(id);
    renumberAttemptPeers(db, {
      recipientId: row.recipient_id,
      clientId: row.client_id,
      caseNumber: row.case_number,
      personBeingServed: row.person_being_served,
    });
    logAuditEvent(db, {
      event_type: "serve.delete",
      actor_user_id: user.id,
      actor_role: user.role,
      target_resource_id: id,
      ip_address: c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "",
      user_agent: c.req.header("user-agent") || "",
    });
    return c.json({ success: true });
  });

  // Multi-Photo Endpoints (Up to 5 Photos per attempt)
  app.get("/api/serves/:id/photos", (c: Context) => {
    const user = getUserOrAdmin(c);
    const serveId = c.req.param("id");
    if (user.role === "server") {
      const serveAttempt = db.query("SELECT case_id, logged_by FROM serve_attempts WHERE id = ?").get(serveId) as { case_id?: string; logged_by?: string } | null;
      if (!serveAttempt) return c.json({ error: "Serve attempt not found" }, 404);
      const isOwner = serveAttempt.logged_by === user.id;
      let isAssigned = false;
      if (serveAttempt.case_id) {
        const cse = db.query("SELECT assigned_to FROM client_cases WHERE id = ?").get(serveAttempt.case_id) as { assigned_to?: string } | null;
        isAssigned = Boolean(cse && (cse.assigned_to === user.id || cse.assigned_to === user.username));
      }
      if (!isOwner && !isAssigned) {
        return c.json({ error: "Forbidden: Not assigned to this attempt" }, 403);
      }
    }
    const rows = db.query("SELECT * FROM serve_attempt_photos WHERE serve_id = ? ORDER BY position ASC").all(serveId) as Record<string, unknown>[];
    return c.json(
      rows.map((p) => ({
        id: p.id,
        position: p.position,
        imageUrl: p.image_url,
        image_url: p.image_url,
        thumbnailUrl: p.thumbnail_url,
        thumbnail_url: p.thumbnail_url,
        mimeType: p.mime_type,
        width: p.width,
        height: p.height,
        fileSize: p.file_size,
      }))
    );
  });

  app.post("/api/serves/:id/photos", async (c: Context) => {
    const user = getUserOrAdmin(c);
    const serveId = c.req.param("id");
    const contentType = c.req.header("content-type") || "";

    const serveRowDb = db.query("SELECT coordinates, service_address, address, case_id, logged_by FROM serve_attempts WHERE id = ?").get(serveId) as {
      coordinates?: string;
      service_address?: string;
      address?: string;
      case_id?: string;
      logged_by?: string;
    } | null;
    if (!serveRowDb) {
      return c.json({ error: "Serve attempt not found" }, 404);
    }

    if (user.role === "server") {
      const isOwner = serveRowDb.logged_by === user.id;
      let isAssigned = false;
      if (serveRowDb.case_id) {
        const cse = db.query("SELECT assigned_to FROM client_cases WHERE id = ?").get(serveRowDb.case_id) as { assigned_to?: string } | null;
        isAssigned = Boolean(cse && (cse.assigned_to === user.id || cse.assigned_to === user.username));
      }
      if (!isOwner && !isAssigned) {
        return c.json({ error: "Forbidden: Not assigned to this attempt" }, 403);
      }
    }

    let position = 1;
    let imageUrl = "";
    let thumbnailUrl = "";
    let fileId = newId();
    let capturedAt = nowIso();
    let stampPath = "";

    const gps = parseLatLng(serveRowDb?.coordinates);
    const address = serveRowDb?.service_address || serveRowDb?.address || "";

    if (contentType.includes("multipart/form-data")) {
      const form = await c.req.parseBody();
      const file = form.file;
      position = Number(form.position) || 1;
      if (form.capturedAt || form.captured_at) {
        capturedAt = String(form.capturedAt || form.captured_at);
      }

      if (file instanceof File) {
        const fn = `${serveId}_p${position}_${fileId.slice(0, 8)}.jpg`;
        const fp = join(UPLOADS_DIR, "serves", fn);
        await writeFile(fp, Buffer.from(await file.arrayBuffer()));
        stampPath = fp;
        imageUrl = `/uploads/serves/${fn}`;
        thumbnailUrl = imageUrl;
      }
    } else {
      const body = await c.req.json();
      position = Number(body.position) || 1;
      capturedAt = body.capturedAt || body.captured_at || capturedAt;
      if (body.imageData && body.imageData.length > 100) {
        const fn = `${serveId}_p${position}_${fileId.slice(0, 8)}.jpg`;
        const fp = join(UPLOADS_DIR, "serves", fn);
        await saveBase64Image(body.imageData, fp, {
          capturedAt,
          latitude: gps?.lat,
          longitude: gps?.lng,
          position,
          address,
        });
        imageUrl = `/uploads/serves/${fn}`;
        thumbnailUrl = imageUrl;
      } else {
        imageUrl = body.imageUrl || body.image_url || "";
        thumbnailUrl = body.thumbnailUrl || body.thumbnail_url || imageUrl;
        if (imageUrl.startsWith("/uploads/")) {
          stampPath = join(UPLOADS_DIR, "serves", imageUrl.split("/").pop()!);
        }
      }
    }

    if (position < 1 || position > 5) {
      return c.json({ error: "Photo position must be between 1 and 5" }, 400);
    }

    if (stampPath) {
      stampServeTrackerPhoto(stampPath, {
        capturedAt,
        latitude: gps?.lat,
        longitude: gps?.lng,
        position,
        address,
      });
    }

    // Delete any existing photo in this slot
    db.query("DELETE FROM serve_attempt_photos WHERE serve_id = ? AND position = ?").run(serveId, position);

    const photoId = newId();
    const label = `ServeTracker Photo ${position}`;
    db.query(
      `INSERT INTO serve_attempt_photos (id, serve_id, position, image_url, image_file_id, thumbnail_url, thumbnail_file_id, created_at, captured_at, label, coordinates)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      photoId,
      serveId,
      position,
      imageUrl,
      fileId,
      thumbnailUrl,
      fileId,
      nowIso(),
      capturedAt,
      label,
      serveRowDb?.coordinates || ""
    );

    // Legacy mirror update if position 1
    if (position === 1) {
      db.query("UPDATE serve_attempts SET image_url = ?, thumbnail_url = ? WHERE id = ?").run(imageUrl, thumbnailUrl, serveId);
    }

    // Exhibits appear on the affidavit → void any signed execution.
    if (serveRowDb?.case_id) {
      invalidateExecutionsForCase(db, serveRowDb.case_id, "material_change");
    }

    return c.json(
      {
        id: photoId,
        serve_id: serveId,
        position,
        image_url: imageUrl,
        thumbnail_url: thumbnailUrl,
        captured_at: capturedAt,
        label,
      },
      201
    );
  });

  app.delete("/api/serves/:id/photos/:photoId", async (c: Context) => {
    const user = getUserOrAdmin(c);
    const serveId = c.req.param("id");
    const photoId = c.req.param("photoId");

    const serveRowDb = db.query("SELECT case_id, logged_by FROM serve_attempts WHERE id = ?").get(serveId) as {
      case_id?: string;
      logged_by?: string;
    } | null;
    if (!serveRowDb) return c.json({ error: "Serve attempt not found" }, 404);

    if (user.role === "server") {
      const isOwner = serveRowDb.logged_by === user.id;
      let isAssigned = false;
      if (serveRowDb.case_id) {
        const cse = db.query("SELECT assigned_to FROM client_cases WHERE id = ?").get(serveRowDb.case_id) as { assigned_to?: string } | null;
        isAssigned = Boolean(cse && (cse.assigned_to === user.id || cse.assigned_to === user.username));
      }
      if (!isOwner && !isAssigned) {
        return c.json({ error: "Forbidden: you can only delete photos on your assigned cases" }, 403);
      }
    }

    db.query("DELETE FROM serve_attempt_photos WHERE id = ? AND serve_id = ?").run(photoId, serveId);

    // Re-pack photo positions 1..N
    const remaining = db.query("SELECT id FROM serve_attempt_photos WHERE serve_id = ? ORDER BY position ASC").all(serveId) as { id: string }[];
    let newPos = 1;
    for (const r of remaining) {
      db.query("UPDATE serve_attempt_photos SET position = ? WHERE id = ?").run(newPos, r.id);
      newPos++;
    }

    // Update position 1 mirror
    const pos1 = db.query("SELECT image_url, thumbnail_url FROM serve_attempt_photos WHERE serve_id = ? AND position = 1").get(serveId) as {
      image_url: string;
      thumbnail_url: string;
    } | null;

    db.query("UPDATE serve_attempts SET image_url = ?, thumbnail_url = ? WHERE id = ?").run(
      pos1 ? pos1.image_url : "",
      pos1 ? pos1.thumbnail_url : "",
      serveId
    );

    if (serveRowDb?.case_id) {
      invalidateExecutionsForCase(db, serveRowDb.case_id, "material_change");
    }

    return c.json({ success: true, count: remaining.length });
  });

  // Structured Affidavit Data API Endpoint
  // Lookup by case UUID first; when using case_number, prefer active row and
  // optional ?client_id= to disambiguate duplicate case numbers (e.g. PG-26-22).
  // Admin OR the assigned field server may read it (role-scoped rows).
  app.get("/api/affidavit/:caseId", (c: Context) => {
    const user = getUserOrAdmin(c);
    const caseId = c.req.param("caseId");
    const clientIdFilter = c.req.query("client_id") || "";

    const caseObj = resolveCase(db, caseId, clientIdFilter);
    if (!caseObj) {
      return c.json({ error: "Case not found" }, 404);
    }

    const isAssignedServer =
      user.role === "server" && String(caseObj.assigned_to || "") === user.id;
    if (user.role !== "admin" && !isAssignedServer) {
      return c.json({ error: "Forbidden: Field servers can only view affidavits for assigned cases" }, 403);
    }

    const role = user.role === "admin" ? "admin" : "server";
    const clientObj = db.query("SELECT * FROM clients WHERE id = ?").get(caseObj.client_id) as Record<string, unknown> | null;
    const recipients = db.query("SELECT * FROM serve_recipients WHERE case_id = ?").all(caseObj.id) as Record<string, unknown>[];
    const serves = db
      .query(ATTEMPTS_FOR_CASE_SQL)
      .all(...attemptsForCaseParams(String(caseObj.id))) as Record<string, unknown>[];

    // Assigned server identity is authoritative for the left signature block.
    let assignedServer: Record<string, unknown> | null = null;
    const assignedTo = String(caseObj.assigned_to || "");
    if (assignedTo) {
      assignedServer = db.query("SELECT * FROM users WHERE id = ? OR username = ?").get(assignedTo, assignedTo) as Record<string, unknown> | null;
    }
    const active = activeExecution(db, String(caseObj.id));

    return c.json({
      case: caseRow(caseObj, role),
      client: role === "admin" && clientObj ? clientRow(clientObj) : null,
      recipients: recipients.map((r) => recipientRow(r, role)),
      attempts: serves.map((s) => serveRow(s, db, role)),
      assignedServer: assignedServer
        ? {
            id: assignedServer.id,
            legalName: assignedServer.legal_name || "",
            displayName: assignedServer.display_name || "",
            licenseNumber: assignedServer.license_number || "",
            licenseJurisdiction: assignedServer.license_jurisdiction || "",
            licenseExpiresAt: assignedServer.license_expires_at || "",
          }
        : null,
      executionStatus: active ? "signed_not_notarized" : "none",
      notaryBlock: {
        serverName: String(
          assignedServer?.legal_name || assignedServer?.display_name || "Joseph Iannazzi"
        ),
        licenseNumber: String(assignedServer?.license_number || "PSL-2026-2"),
        notaryName: "Kimberly Deason",
        commissionExpiration: "02/24/2030",
        state: "OKLAHOMA",
        county: "TULSA",
      },
    });
  });

  // ---------- Admin workload + assignment ----------

  function executionPublic(r: Record<string, unknown>) {
    const signer = db
      .query("SELECT display_name, legal_name FROM users WHERE id = ?")
      .get(String(r.signed_by_user_id || "")) as { display_name?: string; legal_name?: string } | null;
    const actor = db
      .query("SELECT display_name, legal_name FROM users WHERE id = ?")
      .get(String(r.applied_by_user_id || "")) as { display_name?: string; legal_name?: string } | null;
    return {
      id: r.id,
      caseId: r.case_id,
      clientId: r.client_id,
      assignedServerId: r.assigned_server_id,
      signedByUserId: r.signed_by_user_id,
      signedByName: signer?.legal_name || signer?.display_name || "",
      appliedByUserId: r.applied_by_user_id,
      appliedByName: actor?.legal_name || actor?.display_name || "",
      applicationMode: r.application_mode,
      status: r.status,
      sourceHash: r.source_hash,
      renderedHash: r.rendered_hash,
      supersedesExecutionId: r.supersedes_execution_id,
      invalidatedAt: r.invalidated_at,
      invalidationReason: r.invalidation_reason,
      createdAt: r.created_at,
      signedAt: r.signed_at,
      finalizedAt: r.finalized_at,
    };
  }

  // GET /api/admin/server-workload — per-server workload + unassigned work
  app.get("/api/admin/server-workload", (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }

    const servers = db.query(
      `SELECT * FROM users
       WHERE role IN ('server', 'admin')
       ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, created_at ASC`
    ).all() as Record<string, unknown>[];
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const hours48 = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

    const rows = servers.map((s) => {
      const id = String(s.id);
      const activeCases = db
        .query(
          `SELECT id, updated_at, created_at FROM client_cases
           WHERE assigned_to = ? AND lower(COALESCE(status,'')) NOT IN ('closed','completed','served','non-service','nonservice')`
        )
        .all(id) as { id: string; updated_at?: string; created_at?: string }[];

      const assignedActiveCases = activeCases.length;
      const noAttemptCases = activeCases.filter(
        (cse) =>
          !db
            .query("SELECT 1 FROM serve_attempts WHERE case_id = ? LIMIT 1")
            .get(cse.id)
      ).length;
      const stale48hCases = activeCases.filter(
        (cse) => new Date(String(cse.updated_at || cse.created_at || "")).getTime() < new Date(hours48).getTime()
      ).length;

      const activityToday = Number(
        (db
          .query("SELECT COUNT(*) as c FROM serve_attempts WHERE logged_by = ? AND COALESCE(occurred_at, timestamp) >= ?")
          .get(id, todayIso) as { c: number }).c || 0
      );
      const activity7Days = Number(
        (db
          .query("SELECT COUNT(*) as c FROM serve_attempts WHERE logged_by = ? AND COALESCE(occurred_at, timestamp) >= ?")
          .get(id, weekAgo) as { c: number }).c || 0
      );
      const lastAttempt = db
        .query("SELECT MAX(COALESCE(occurred_at, timestamp)) as m FROM serve_attempts WHERE logged_by = ?")
        .get(id) as { m?: string | null };
      const lastActivity = [String(s.last_login_at || ""), String(s.last_activity_at || ""), lastAttempt?.m || ""]
        .filter(Boolean)
        .sort()
        .pop() || "";

      let signatureStatus = "none";
      if (String(s.signature_asset_id || "")) {
        const asset = db
          .query("SELECT status FROM user_signature_assets WHERE id = ?")
          .get(String(s.signature_asset_id)) as { status?: string } | null;
        signatureStatus = asset?.status === "active" ? "enrolled" : asset?.status === "revoked" ? "revoked" : "none";
      }

      const territory = (() => {
        try {
          const t = JSON.parse(String(s.service_territory_json || "[]"));
          return Array.isArray(t) ? t : [];
        } catch {
          return [];
        }
      })();

      const licenseStatus = computeLicenseStatus(s.license_number, s.license_jurisdiction, s.license_expires_at);

      return {
        id,
        username: s.username,
        displayName: s.display_name,
        legalName: s.legal_name || "",
        role: s.role,
        isActive: s.is_active === 1 || s.is_active === true,
        onboardingStatus: s.onboarding_status || "pending",
        licenseStatus,
        licenseExpiresAt: s.license_expires_at || "",
        phone: s.phone || "",
        email: s.email || "",
        serviceTerritory: territory,
        profileNotes: s.profile_notes || "",
        assignedActiveCases,
        noAttemptCases,
        stale48hCases,
        activityToday,
        activity7Days,
        lastActivity,
        signatureStatus,
        profileCompleteness: {
          profileComplete: Boolean(
            String(s.email || "").trim() &&
              String(s.phone || "").trim() &&
              String(s.legal_name || "").trim() &&
              territory.length > 0
          ),
          licenseComplete: licenseStatus === "valid" || licenseStatus === "expires_soon",
        },
      };
    });

    const unassignedActiveCases = Number(
      (db
        .query(
          `SELECT COUNT(*) as c FROM client_cases
           WHERE (assigned_to = '' OR assigned_to IS NULL) AND lower(COALESCE(status,'')) NOT IN ('closed','completed','served','non-service','nonservice')`
        )
        .get() as { c: number }).c || 0
    );

    return c.json({ servers: rows, unassignedActiveCases, activityWindow: { today: todayIso, weekAgo, dayAgo } });
  });

  // GET /api/admin/servers/:id/cases — assigned cases + assignment history
  app.get("/api/admin/servers/:id/cases", (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const id = c.req.param("id");
    const serverRow = db.query("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!serverRow) return c.json({ error: "Server not found" }, 404);

    const cases = db
      .query("SELECT * FROM client_cases WHERE assigned_to = ? ORDER BY created_at DESC")
      .all(id) as Record<string, unknown>[];

    const caseIds = cases.map((cse) => String(cse.id));
    let events: Record<string, unknown>[] = [];
    if (caseIds.length > 0) {
      const placeholders = caseIds.map(() => "?").join(",");
      events = db
        .query(
          `SELECT * FROM case_assignment_events WHERE case_id IN (${placeholders}) ORDER BY occurred_at DESC`
        )
        .all(...caseIds) as Record<string, unknown>[];
    }

    return c.json({
      server: {
        id: serverRow.id,
        username: serverRow.username,
        displayName: serverRow.display_name,
        legalName: serverRow.legal_name || "",
        isActive: serverRow.is_active === 1 || serverRow.is_active === true,
        onboardingStatus: serverRow.onboarding_status || "pending",
      },
      cases: cases.map((cse) => caseRow(cse, "admin")),
      assignment_history: events.map((e) => ({
        id: e.id,
        case_id: e.case_id,
        previous_server_id: e.previous_server_id,
        new_server_id: e.new_server_id,
        actor_user_id: e.actor_user_id,
        occurred_at: e.occurred_at,
        note: e.note,
      })),
    });
  });

  // POST /api/admin/cases/:id/assign — validated assignment with event record
  app.post("/api/admin/cases/:id/assign", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const id = c.req.param("id");
    const caseObj = resolveCase(db, id);
    if (!caseObj) return c.json({ error: "Case not found" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const serverId = String(body.serverId || body.server_id || body.assigned_to || body.assignedTo || "").trim();
    if (!serverId) return c.json({ error: "serverId is required" }, 400);

    const assignErr = validateAssignTarget(db, serverId);
    if (assignErr) return c.json({ error: assignErr }, 400);

    applyAssignment(db, String(caseObj.id), serverId, user.id, "assigned");
    const row = db.query("SELECT * FROM client_cases WHERE id = ?").get(caseObj.id) as Record<string, unknown>;
    return c.json(caseRow(row, "admin"));
  });

  // POST /api/admin/cases/:id/unassign — explicit unassign with event record
  app.post("/api/admin/cases/:id/unassign", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const id = c.req.param("id");
    const caseObj = resolveCase(db, id);
    if (!caseObj) return c.json({ error: "Case not found" }, 404);

    applyAssignment(db, String(caseObj.id), "", user.id, "unassigned");
    const row = db.query("SELECT * FROM client_cases WHERE id = ?").get(caseObj.id) as Record<string, unknown>;
    return c.json(caseRow(row, "admin"));
  });

  // GPS → Oklahoma county for the notary jurat (Nominatim via server so field phones don't hit CORS).
  app.get("/api/geo/county", async (c: Context) => {
    getUserOrAdmin(c);
    const lat = Number(c.req.query("lat"));
    const lon = Number(c.req.query("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return c.json({ error: "lat and lon are required" }, 400);
    }
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}&zoom=10&addressdetails=1`;
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "ServeTracker-staging/1.0 (process serving affidavits)",
        },
      });
      if (!res.ok) return c.json({ error: "Geocoder unavailable" }, 502);
      const data = (await res.json()) as {
        address?: { county?: string; state?: string; country_code?: string };
      };
      const countyRaw = String(data.address?.county || "").replace(/\s+County$/i, "").trim();
      const stateRaw = String(data.address?.state || "").trim();
      const country = String(data.address?.country_code || "").toLowerCase();
      if (!countyRaw) return c.json({ error: "County not found for this location" }, 404);
      return c.json({
        county: countyRaw.toUpperCase(),
        state: stateRaw ? stateRaw.toUpperCase() : country === "us" ? "OKLAHOMA" : "",
        countryCode: country,
        lat,
        lon,
      });
    } catch {
      return c.json({ error: "Geocoder unavailable" }, 502);
    }
  });

  // ---------- Affidavit e-signature ----------

  // POST /api/affidavits/prepare — readiness + preview + snapshot hash
  app.post("/api/affidavits/prepare", async (c: Context) => {
    const user = getUserOrAdmin(c);
    const body = await c.req.json().catch(() => ({}));
    const caseKey = String(body.caseId || body.case_id || "");
    if (!caseKey) return c.json({ error: "caseId is required" }, 400);

    const bundle = loadCaseBundle(db, caseKey);
    if (!bundle) return c.json({ error: "Case not found" }, 404);

    if (user.role !== "admin" && String(bundle.caseObj.assigned_to || "") !== user.id) {
      return c.json(
        { error: "Forbidden: only the assigned server or an administrator can prepare this affidavit" },
        403
      );
    }

    const requestedKind = String(body.affidavitKind || body.affidavit_kind || "").trim();
    const recipientId = String(body.recipientId || body.recipient_id || "").trim();
    const kind = inferAffidavitKind(bundle.attempts, requestedKind);

    // With more than one legal recipient there is no safe default: silently
    // picking the first is what let an LLC inherit its agent's personal serve.
    if (!recipientId && bundle.recipients.length > 1) {
      return c.json(
        {
          error: "recipientId is required: this case has multiple recipients — choose who this affidavit is for",
          ready: false,
          recipientRequired: true,
          recipients: bundle.recipients.map((r) => ({ id: r.id, full_name: r.full_name, role: r.role || "" })),
        },
        400
      );
    }

    const targetRec = resolveTargetRecipient(bundle, recipientId);
    if (recipientId && !targetRec) {
      return c.json({ error: "Recipient does not belong to this case", ready: false }, 404);
    }

    const v = validateSignable(db, String(bundle.caseObj.id), undefined, kind, recipientId || undefined);
    if (!v.ok) return c.json({ error: v.error, ready: false }, 400);

    const sig = activeSignature(db, String(bundle.assignedServer!.id));
    const snapshot = buildSourceSnapshot(bundle, sig, kind, undefined, recipientId || undefined);
    const sourceHash = sha256Hex(snapshot);

    const lastSuccessful = latestSuccessfulServe(
      bundle.attempts,
      String(targetRec?.id || ""),
      String(targetRec?.full_name || "")
    ) as { service_method?: string; accepted_by?: string } | null;
    const assigned = bundle.assignedServer!;
    const active = activeExecution(db, String(bundle.caseObj.id), String(targetRec?.id || "") || undefined);

    return c.json({
      ready: true,
      caseId: bundle.caseObj.id,
      caseNumber: bundle.caseObj.case_number,
      sourceHash,
      recipientId: targetRec?.id || null,
      assignedServer: {
        id: assigned.id,
        legalName: assigned.legal_name || "",
        displayName: assigned.display_name || "",
        licenseNumber: assigned.license_number || "",
        licenseJurisdiction: assigned.license_jurisdiction || "",
        signatureEnrolled: Boolean(sig),
      },
      preview: {
        title: kind === "service" ? "AFFIDAVIT OF SERVICE" : "AFFIDAVIT OF NON-SERVICE",
        kind,
        caseNumber: String(bundle.caseObj.case_number || ""),
        caseName: String(bundle.caseObj.case_name || ""),
        personServed: String(
          targetRec?.full_name || bundle.recipients[0]?.full_name || bundle.caseObj.defendant_respondent || bundle.caseObj.case_name || ""
        ),
        documents: String(bundle.caseObj.documents_to_serve || ""),
        attemptsCount: bundle.attempts.length,
        method: String(lastSuccessful?.service_method || ""),
        methodRecorded: !methodBlockingError(
          bundle.attempts,
          kind,
          String(targetRec?.id || ""),
          String(targetRec?.full_name || "")
        ),
        acceptedBy: String(lastSuccessful?.accepted_by || ""),
      },
      executionStatus: active ? "signed_not_notarized" : "none",
    });
  });

  // POST /api/affidavits/:id/sign — server_self or admin_on_behalf (never notarizes)
  app.post("/api/affidavits/:id/sign", async (c: Context) => {
    const user = getUserOrAdmin(c);
    const caseKey = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const requestedKind = String(body.affidavitKind || body.affidavit_kind || "").trim();
    const recipientId = String(body.recipientId || body.recipient_id || "").trim();
    const venueCounty = String(body.notaryCounty || body.notary_county || "").trim().toUpperCase();
    const venueState = String(body.notaryState || body.notary_state || "OKLAHOMA").trim().toUpperCase() || "OKLAHOMA";

    const bundle = loadCaseBundle(db, caseKey);
    if (!bundle) return c.json({ error: "Case not found" }, 404);
    const assigned = bundle.assignedServer;
    if (!assigned) return c.json({ error: "Case is not assigned to a field server" }, 400);
    const kind = inferAffidavitKind(bundle.attempts, requestedKind);

    const isSelf =
      String(assigned.id) === user.id ||
      String(assigned.username || "").toLowerCase() === String(user.username || "").toLowerCase();
    if (user.role !== "admin" && !isSelf) {
      return c.json({ error: "Forbidden: you can only sign affidavits assigned to you" }, 403);
    }

    // A sworn statement names one recipient. Refuse to guess which one.
    if (!recipientId && bundle.recipients.length > 1) {
      return c.json(
        {
          error: "recipientId is required: this case has multiple recipients — choose who this affidavit is for",
          recipientRequired: true,
          recipients: bundle.recipients.map((r) => ({ id: r.id, full_name: r.full_name, role: r.role || "" })),
        },
        400
      );
    }
    const targetRec = resolveTargetRecipient(bundle, recipientId);
    if (recipientId && !targetRec) {
      return c.json({ error: "Recipient does not belong to this case" }, 404);
    }

    const v = validateSignable(db, String(bundle.caseObj.id), undefined, kind, recipientId || undefined);
    if (!v.ok) return c.json({ error: v.error }, 400);

    const sig = v.signature!;
    const snapshot = buildSourceSnapshot(v.bundle!, sig, kind, {
      state: venueState || "OKLAHOMA",
      county: venueCounty,
    }, recipientId || undefined);
    const sourceHash = sha256Hex(snapshot);
    const mode: "server_self" | "admin_on_behalf" =
      user.role === "admin" && !isSelf ? "admin_on_behalf" : "server_self";
    // Version chains are per recipient: signing the LLC does not supersede the
    // affidavit already sworn for the individual.
    const prev = latestExecution(db, String(bundle.caseObj.id), String(targetRec?.id || "") || undefined);

    // First create a temporary execution record so renderExecutionHtml can read it
    const tempExecution = createExecution(db, {
      caseId: String(bundle.caseObj.id),
      clientId: String(bundle.caseObj.client_id),
      assignedServerId: String(assigned.id),
      signedByUserId: String(assigned.id),
      appliedByUserId: String(user.id || assigned.id),
      applicationMode: mode,
      sourceSnapshotJson: snapshot,
      sourceHash,
      renderedHash: "pending",
      supersedesExecutionId: prev ? String(prev.id) : undefined,
    });

    const rendered = await renderExecutionHtml(db, tempExecution);
    const renderedHash = rendered ? sha256Hex(rendered.html) : sha256Hex(`${sourceHash}|${String(sig.sha256)}|${mode}`);
    db.query("UPDATE affidavit_executions SET rendered_hash = ? WHERE id = ?").run(renderedHash, tempExecution.id);
    tempExecution.rendered_hash = renderedHash;

    return c.json({ success: true, status: "signed_not_notarized", execution: executionPublic(tempExecution) }, 201);
  });

  // GET /api/affidavits/:id/render — signed HTML with embedded signature (auth-gated)
  app.get("/api/affidavits/:id/render", async (c: Context) => {
    const user = getUserOrAdmin(c);
    const caseKey = c.req.param("id");
    const recipientId = c.req.query("recipientId") || c.req.query("recipient_id") || "";
    const bundle = loadCaseBundle(db, caseKey);
    if (!bundle) return c.json({ error: "Case not found" }, 404);

    const isAssigned =
      String(bundle.caseObj.assigned_to || "") === user.id ||
      String(bundle.caseObj.assigned_to || "").toLowerCase() === String(user.username || "").toLowerCase();
    if (user.role !== "admin" && !isAssigned) {
      return c.json({ error: "Forbidden: only the assigned server or an administrator can render this affidavit" }, 403);
    }

    const targetRec = resolveTargetRecipient(bundle, recipientId);
    if (recipientId && !targetRec) {
      return c.json({ error: "Recipient does not belong to this case" }, 404);
    }

    // Strict: with a recipient named, only that recipient's own signed
    // execution may be returned — never a co-recipient's affidavit.
    const exec = activeExecution(db, String(bundle.caseObj.id), recipientId || undefined);
    if (!exec) {
      const who = recipientId ? ` for ${String(targetRec?.full_name || "this recipient")}` : "";
      return c.json(
        {
          error: `No active signed affidavit${who} — sign the affidavit first`,
          status: "none",
          recipientId: recipientId || null,
        },
        409
      );
    }

    const rendered = await renderExecutionHtml(db, exec);
    if (!rendered) return c.json({ error: "Could not render affidavit" }, 500);
    return c.json({ execution: executionPublic(exec), html: rendered.html });
  });

  // GET /api/affidavits/:id/audit — execution history for the case
  app.get("/api/affidavits/:id/audit", (c: Context) => {
    const user = getUserOrAdmin(c);
    const caseKey = c.req.param("id");
    const bundle = loadCaseBundle(db, caseKey);
    if (!bundle) return c.json({ error: "Case not found" }, 404);

    if (user.role !== "admin" && String(bundle.caseObj.assigned_to || "") !== user.id) {
      return c.json({ error: "Forbidden: only the assigned server or an administrator can view the audit log" }, 403);
    }

    const rows = db
      .query("SELECT * FROM affidavit_executions WHERE case_id = ? ORDER BY created_at DESC")
      .all(bundle.caseObj.id) as Record<string, unknown>[];
    return c.json({ executions: rows.map((r) => executionPublic(r)) });
  });

  // GET /api/affidavits/queue — pending affidavits needing signature (for server or admin)
  app.get("/api/affidavits/queue", (c: Context) => {
    const user = getUserOrAdmin(c);
    if (!user?.id) return c.json({ error: "Unauthorized" }, 401);

    const signedCaseIds = new Set(
      (
        db
          .query(
            "SELECT DISTINCT case_id FROM affidavit_executions WHERE status = 'signed_not_notarized' AND (invalidated_at = '' OR invalidated_at IS NULL)"
          )
          .all() as Array<{ case_id: string }>
      ).map((r) => r.case_id)
    );

    const casesQuery = `
      SELECT c.*,
        (SELECT s.status FROM serve_attempts s WHERE (s.case_id = c.id OR s.case_number = c.case_number) ORDER BY s.occurred_at DESC LIMIT 1) as last_service_type,
        (SELECT s.service_method FROM serve_attempts s WHERE (s.case_id = c.id OR s.case_number = c.case_number) ORDER BY s.occurred_at DESC LIMIT 1) as last_service_method,
        (SELECT s.occurred_at FROM serve_attempts s WHERE (s.case_id = c.id OR s.case_number = c.case_number) ORDER BY s.occurred_at DESC LIMIT 1) as last_served_at
      FROM client_cases c
    `;
    let rows: Record<string, unknown>[];

    if (user.role === "server") {
      rows = db
        .query(`${casesQuery} WHERE (c.assigned_to = ? OR c.assigned_to = ?) ORDER BY c.created_at DESC`)
        .all(user.id, user.username) as Record<string, unknown>[];
    } else {
      rows = db
        .query(
          `${casesQuery} WHERE c.assigned_to IS NOT NULL AND TRIM(c.assigned_to) != '' ORDER BY c.created_at DESC`
        )
        .all() as Record<string, unknown>[];
    }

    const queue: Array<Record<string, unknown>> = [];
    for (const r of rows) {
      const caseId = String(r.id);
      if (signedCaseIds.has(caseId)) continue;
      const assignedTo = String(r.assigned_to || "").trim();
      if (!assignedTo) continue;

      const status = String(r.status || "").toLowerCase();
      const lastType = String(r.last_service_type || "").toLowerCase();
      const isServed = status === "served" || status === "completed" || lastType === "serve";

      if (isServed) {
        queue.push({
          caseId,
          caseNumber: String(r.case_number || ""),
          caseName: String(r.case_name || r.defendant_respondent || ""),
          defendantName: String(r.defendant_respondent || ""),
          personServed: String(r.defendant_respondent || r.case_name || "Recipient"),
          serviceMethod: String(r.last_service_method || "Personal Service"),
          servedAt: String(r.last_served_at || r.updated_at || r.created_at || ""),
          assignedServerName: String(r.assigned_name || "Assigned Server"),
          status: String(r.status || "Served"),
          clientName: user.role === "admin" ? String(r.client_name || "") : undefined,
        });
      }
    }

    return c.json({ queue });
  });

  // Client Documents
  app.get("/api/documents", (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role !== "admin") {
      return c.json({ error: "Forbidden: Field servers cannot access documents" }, 403);
    }
    const clientId = c.req.query("client_id");
    const caseNumber = c.req.query("case_number");
    const hasClientId = clientId !== undefined && clientId !== "";
    const hasCaseNumber = caseNumber !== undefined && caseNumber !== "";

    let rows: Record<string, unknown>[];
    if (hasClientId && hasCaseNumber) {
      rows = db
        .query("SELECT * FROM client_documents WHERE client_id = ? AND case_number = ? ORDER BY created_at DESC")
        .all(clientId, caseNumber) as Record<string, unknown>[];
    } else if (hasClientId) {
      rows = db
        .query("SELECT * FROM client_documents WHERE client_id = ? ORDER BY created_at DESC")
        .all(clientId) as Record<string, unknown>[];
    } else {
      rows = db.query("SELECT * FROM client_documents ORDER BY created_at DESC").all() as Record<string, unknown>[];
    }
    return c.json(rows.map(documentRow));
  });

  app.post("/api/documents", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role !== "admin") {
      return c.json({ error: "Forbidden: Field servers cannot upload client documents" }, 403);
    }
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) {
      return c.json({ error: "file required" }, 400);
    }

    const clientId = String(form.clientId || form.client_id || "");
    const caseNumber = String(form.caseNumber || form.case_number || "");
    const description = String(form.description || "");
    const cleanName = sanitizeDocumentFilename(file.name);
    const id = newId();
    const fileId = newId();
    const clientDir = join(UPLOADS_DIR, "documents", clientId.replace(/[^a-zA-Z0-9_-]/g, ""));
    await mkdir(clientDir, { recursive: true });
    const destPath = join(clientDir, `${fileId}_${cleanName}`);
    if (!destPath.startsWith(clientDir)) {
      return c.json({ error: "Invalid path" }, 400);
    }
    await writeFile(destPath, Buffer.from(await file.arrayBuffer()));

    const createdAt = nowIso();
    db.query(
      `INSERT INTO client_documents (id, client_id, case_number, file_name, file_size, file_type, file_path, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, clientId, caseNumber, cleanName, file.size, file.type, `${clientId}/${fileId}_${cleanName}`, description, createdAt);

    const row = db.query("SELECT * FROM client_documents WHERE id = ?").get(id) as Record<string, unknown>;
    return c.json(documentRow(row), 201);
  });

  // Filename Sanitizer to prevent Directory Traversal attacks
  function sanitizeDocumentFilename(rawName: string): string {
    const ext = rawName.includes(".") ? "." + rawName.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "") : ".pdf";
    const base = rawName.substring(0, rawName.lastIndexOf(".") !== -1 ? rawName.lastIndexOf(".") : rawName.length)
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 80);
    return `${base || "court_document"}${ext}`;
  }

  // GET /api/cases/:id/documents — Role-Gated Case Documents Listing
  app.get("/api/cases/:id/documents", (c: Context) => {
    const user = getUserOrAdmin(c);
    if (!user || user.role === "unauthorized") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const caseId = c.req.param("id");
    const caseObj = resolveCase(db, caseId);
    if (!caseObj) return c.json({ error: "Case not found" }, 404);

    // Field Server RBAC Gate: Must be assigned to this case
    if (user.role === "server") {
      const isAssigned = String(caseObj.assigned_to || "") === user.id || String(caseObj.assigned_to || "") === user.username;
      if (!isAssigned) return c.json({ error: "Forbidden: You are not assigned to this case" }, 403);
    }

    const rows = db.query(
      "SELECT id, client_id, case_id, case_number, file_name, file_size, file_type, description, is_archived, gdrive_file_id, created_at FROM client_documents WHERE (case_id = ? OR (case_id = '' AND case_number = ?)) ORDER BY created_at ASC"
    ).all(caseObj.id, caseObj.case_number) as Record<string, unknown>[];

    return c.json(rows.map(r => ({
      id: r.id,
      caseId: r.case_id || caseObj.id,
      fileName: r.file_name,
      fileSize: r.file_size,
      fileType: r.file_type,
      description: r.description || "",
      isArchived: r.is_archived === 1,
      hasDriveBackup: !!r.gdrive_file_id,
      createdAt: r.created_at
    })));
  });

  // POST /api/cases/:id/documents — Upload Court Documents Attached to Case (Admin only)
  app.post("/api/cases/:id/documents", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }

    const caseId = c.req.param("id");
    const caseObj = resolveCase(db, caseId);
    if (!caseObj) return c.json({ error: "Case not found" }, 404);

    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) {
      return c.json({ error: "File required" }, 400);
    }

    const description = String(form.description || form.category || "Court Document");
    const cleanFileName = sanitizeDocumentFilename(file.name);
    const id = newId();
    const fileId = newId();
    const fileBuf = Buffer.from(await file.arrayBuffer());

    // Preflight check for PDF corruption or password lock
    if (file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf") {
      try {
        const { PDFDocument } = await import("pdf-lib");
        await PDFDocument.load(fileBuf, { ignoreEncryption: false });
      } catch (err: any) {
        if (err?.message?.includes("encrypt") || err?.message?.includes("password")) {
          return c.json({ error: "This PDF is password-protected. Please upload an unlocked copy." }, 400);
        }
        console.warn("[DocUpload] PDF-lib preflight warning (continuing):", err?.message);
      }
    }

    const crypto = await import("crypto");
    const sha256Hex = crypto.createHash("sha256").update(fileBuf).digest("hex");

    const caseDir = join(UPLOADS_DIR, "documents", String(caseObj.id));
    await mkdir(caseDir, { recursive: true });
    const storageKey = `${String(caseObj.id)}/${fileId}_${cleanFileName}`;
    const destPath = join(caseDir, `${fileId}_${cleanFileName}`);
    await writeFile(destPath, fileBuf);

    const createdAt = nowIso();
    db.query(
      `INSERT INTO client_documents (id, client_id, case_id, case_number, file_name, file_size, file_type, file_path, file_hash, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      String(caseObj.client_id || ""),
      String(caseObj.id),
      String(caseObj.case_number || ""),
      cleanFileName,
      file.size,
      file.type || "application/pdf",
      storageKey,
      sha256Hex,
      description,
      createdAt
    );

    const row = db.query("SELECT * FROM client_documents WHERE id = ?").get(id) as Record<string, unknown>;
    logAuditEvent(db, {
      event_type: "docs.upload",
      actor_user_id: user.id,
      actor_role: user.role,
      target_resource_id: id,
      ip_address: c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "",
      user_agent: c.req.header("user-agent") || "",
      details: { case_id: String(caseObj.id), file_name: cleanFileName },
    });
    return c.json(documentRow(row), 201);
  });

  // POST /api/cases/by-number/:caseNumber/documents — Upload documents by Case Number (Google Apps Script / Webhook / Hermes)
  app.post("/api/cases/by-number/:caseNumber/documents", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const caseNumber = c.req.param("caseNumber");
    const caseObj = db.query(
      "SELECT * FROM client_cases WHERE case_number = ? OR case_number = ? ORDER BY created_at DESC LIMIT 1"
    ).get(caseNumber, caseNumber.replace(/-/g, "")) as Record<string, unknown> | null;
    if (!caseObj) return c.json({ error: `Case '${caseNumber}' not found` }, 404);

    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) {
      return c.json({ error: "File required" }, 400);
    }

    const description = String(form.description || form.category || "Court Document");
    const cleanFileName = sanitizeDocumentFilename(file.name);
    const id = newId();
    const fileId = newId();
    const fileBuf = Buffer.from(await file.arrayBuffer());

    const crypto = await import("crypto");
    const sha256Hex = crypto.createHash("sha256").update(fileBuf).digest("hex");

    const caseDir = join(UPLOADS_DIR, "documents", String(caseObj.id));
    await mkdir(caseDir, { recursive: true });
    const storageKey = `${String(caseObj.id)}/${fileId}_${cleanFileName}`;
    const destPath = join(caseDir, `${fileId}_${cleanFileName}`);
    await writeFile(destPath, fileBuf);

    const createdAt = nowIso();
    db.query(
      `INSERT INTO client_documents (id, client_id, case_id, case_number, file_name, file_size, file_type, file_path, file_hash, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      String(caseObj.client_id || ""),
      String(caseObj.id),
      String(caseObj.case_number || ""),
      cleanFileName,
      file.size,
      file.type || "application/pdf",
      storageKey,
      sha256Hex,
      description,
      createdAt
    );

    const row = db.query("SELECT * FROM client_documents WHERE id = ?").get(id) as Record<string, unknown>;
    return c.json(documentRow(row), 201);
  });

  // GET /api/cases/:id/documents/:docId/download — Authenticated Binary Stream
  app.get("/api/cases/:id/documents/:docId/download", async (c: Context) => {
    const user = getUserOrAdmin(c);
    const caseId = c.req.param("id");
    const docId = c.req.param("docId");
    const caseObj = resolveCase(db, caseId);
    if (!caseObj) return c.json({ error: "Case not found" }, 404);

    if (user.role === "server") {
      const isAssigned = String(caseObj.assigned_to || "") === user.id || String(caseObj.assigned_to || "") === user.username;
      if (!isAssigned) return c.json({ error: "Forbidden: You are not assigned to this case" }, 403);
    }

    // STRICT IDOR GUARD: Document must belong to this case (or client-scoped case_number legacy fallback)
    const doc = db.query(
      "SELECT * FROM client_documents WHERE id = ? AND (case_id = ? OR (case_id = '' AND client_id = ? AND case_number = ?))"
    ).get(docId, caseObj.id, caseObj.client_id, caseObj.case_number) as Record<string, unknown> | null;
    if (!doc) return c.json({ error: "Document not found for this case" }, 404);

    const { resolve, sep } = await import("path");
    const baseDocsDir = resolve(UPLOADS_DIR, "documents");
    const absPath = resolve(baseDocsDir, String(doc.file_path));

    // Path Traversal Security Check
    if (!absPath.startsWith(baseDocsDir + sep) && absPath !== baseDocsDir) {
      return c.json({ error: "Security violation: Invalid file path" }, 400);
    }

    const file = Bun.file(absPath);
    if (!(await file.exists())) {
      return c.json({ error: "Document file not found on server (may be archived in Drive)" }, 404);
    }

    const buffer = await file.arrayBuffer();
    const mime = String(doc.file_type || "application/pdf");
    const fileName = String(doc.file_name || "document.pdf");

    logAuditEvent(db, {
      event_type: "docs.download",
      actor_user_id: user.id,
      actor_role: user.role,
      target_resource_id: docId,
      ip_address: c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "",
      user_agent: c.req.header("user-agent") || "",
      details: { case_id: caseId, file_name: fileName },
    });

    return new Response(buffer, {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `inline; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-cache, no-store",
      },
    });
  });

  // DELETE /api/cases/:id/documents/:docId — Admin Document Deletion
  app.delete("/api/cases/:id/documents/:docId", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const docId = c.req.param("docId");
    const row = db.query("SELECT file_path FROM client_documents WHERE id = ?").get(docId) as { file_path: string } | null;
    if (row) await deleteDocumentFile(row.file_path);
    db.query("DELETE FROM client_documents WHERE id = ?").run(docId);
    logAuditEvent(db, {
      event_type: "docs.delete",
      actor_user_id: user.id,
      actor_role: user.role,
      target_resource_id: docId,
      ip_address: c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "",
      user_agent: c.req.header("user-agent") || "",
    });
    return c.json({ success: true });
  });

  app.post("/api/email/send", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    try {
      const body = await c.req.json();
      const result = await sendEmail(body);
      return c.json(result);
    } catch (error) {
      return c.json({ success: false, message: error instanceof Error ? error.message : "Unknown error" }, 500);
    }
  });

  app.post("/api/backup", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const { execSync } = await import("child_process");
    const BACKUP_DIR = join(process.cwd(), "backups");
    await mkdir(BACKUP_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const zipPath = join(BACKUP_DIR, `pdfusaedit-backup-${timestamp}.zip`);
    try {
      execSync(`cd ${process.cwd()} && zip -r "${zipPath}" data/ -x "data/*.db-wal" "data/*.db-shm"`, { stdio: "pipe" });
      const stats = await import("fs/promises").then((fs) => fs.stat(zipPath));
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
      return c.json({ success: true, path: zipPath, sizeMB, timestamp });
    } catch (error) {
      return c.json({ success: false, error: error instanceof Error ? error.message : "Backup failed" }, 500);
    }
  });

  app.post("/api/backup/upload", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const { execSync } = await import("child_process");
    try {
      const result = execSync("bash /home/workspace/Projects/PDFUSAEDIT-zo/scripts/upload-to-drive.sh 2>&1", { encoding: "utf8" });
      return c.json({ success: true, output: result });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Upload failed";
      return c.json({ success: false, error: msg }, 500);
    }
  });

  // Notifications & Push API
  app.get("/api/notifications", (c: Context) => {
    const user = getUserOrAdmin(c);
    const rows = db.query(
      "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"
    ).all(user.id) as Record<string, unknown>[];
    const unreadCount = (db.query(
      "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND (read_at = '' OR read_at IS NULL)"
    ).get(user.id) as { count: number }).count;
    return c.json({ notifications: rows, unreadCount });
  });

  app.patch("/api/notifications/:id/read", (c: Context) => {
    const user = getUserOrAdmin(c);
    const id = c.req.param("id");
    db.query("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?").run(
      nowIso(),
      id,
      user.id
    );
    return c.json({ success: true });
  });

  app.patch("/api/notifications/read-all", (c: Context) => {
    const user = getUserOrAdmin(c);
    db.query("UPDATE notifications SET read_at = ? WHERE user_id = ? AND (read_at = '' OR read_at IS NULL)").run(
      nowIso(),
      user.id
    );
    return c.json({ success: true });
  });

  // Web Push VAPID public key — the browser needs it to create a subscription
  app.get("/api/push/vapid-public-key", async (c: Context) => {
    const { getVapidPublicKey } = await import("./notifications");
    const key = getVapidPublicKey();
    if (!key) return c.json({ error: "VAPID not configured on server" }, 500);
    return c.json({ publicKey: key });
  });

  // Register / refresh a Push API subscription for the authenticated user.
  // The browser sends this after pushManager.subscribe() succeeds.
  app.post("/api/push-subscriptions", async (c: Context) => {
    const user = getUserOrAdmin(c);
    const body = await c.req.json().catch(() => ({}));
    const endpoint = String(body.endpoint || "").trim();
    const p256dh = String(body.keys?.p256dh || "").trim();
    const auth = String(body.keys?.auth || "").trim();

    if (!endpoint || !p256dh || !auth) {
      return c.json({ error: "endpoint, keys.p256dh and keys.auth are required" }, 400);
    }

    const ua = c.req.header("user-agent") || "";
    const platform = String(body.platform || detectPlatform(ua));
    const now = nowIso();

    // Upsert keyed on the unique endpoint; re-assign to the current user
    // (same device re-login) and refresh last_seen_at.
    db.query(`
      INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, platform, user_agent, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        platform = excluded.platform,
        user_agent = excluded.user_agent,
        last_seen_at = excluded.last_seen_at
    `).run(newId(), user.id, endpoint, p256dh, auth, platform, ua.slice(0, 300), now, now);

    return c.json({ success: true });
  });

  // Remove a Push API subscription (logout / permission revoked)
  app.delete("/api/push-subscriptions", async (c: Context) => {
    const user = getUserOrAdmin(c);
    const body = await c.req.json().catch(() => ({}));
    const endpoint = String(body.endpoint || c.req.query("endpoint") || "").trim();
    if (!endpoint) return c.json({ error: "endpoint is required" }, 400);
    db.query("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").run(endpoint, user.id);
    return c.json({ success: true });
  });

  // Targeted Direct Notification to a specific field server
  app.post("/api/admin/servers/:id/notify", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const serverId = c.req.param("id");
    const serverRow = db.query("SELECT id, display_name, username, email, phone FROM users WHERE id = ?").get(serverId) as {
      id: string;
      display_name: string;
      username: string;
      email?: string;
      phone?: string;
    } | null;

    if (!serverRow) return c.json({ error: "Server not found" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const title = String(body.title || "Dispatch Directive").trim();
    const message = String(body.message || "").trim();
    const priority = (body.priority || "high") as "normal" | "high" | "urgent";

    if (!message) return c.json({ error: "Message is required" }, 400);

    const { createNotification } = await import("./notifications");
    const notif = await createNotification(db as any, {
      userId: serverRow.id,
      type: "nudge",
      priority,
      title,
      body: message,
      actionUrl: "/dashboard",
    });

    return c.json({ success: true, notification: notif });
  });

  // Targeted Admin Nudge to an assigned server
  app.post("/api/admin/cases/:id/nudge", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const id = c.req.param("id");
    const caseObj = resolveCase(db, id);
    if (!caseObj) return c.json({ error: "Case not found" }, 404);

    const assignedTo = String(caseObj.assigned_to || "").trim();
    if (!assignedTo) return c.json({ error: "Cannot nudge: No server assigned to this case" }, 400);

    const body = await c.req.json().catch(() => ({}));
    const message = String(body.message || "Attempt needed today").trim();
    const caseNum = String(caseObj.case_number || "Case");
    const person = String(caseObj.defendant_respondent || caseObj.case_name || "");

    const { createNotification } = await import("./notifications");
    const notif = await createNotification(db as any, {
      userId: assignedTo,
      type: "nudge",
      priority: "high",
      title: `Action Requested: ${caseNum}`,
      body: `${message} for ${person || caseNum}`,
      entityType: "case",
      entityId: String(caseObj.id),
      actionUrl: `/dashboard?caseId=${caseObj.id}`,
    });

    return c.json({ success: true, notification: notif });
  });

  // Admin Team Broadcast
  app.post("/api/admin/broadcast", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const body = await c.req.json().catch(() => ({}));
    const title = String(body.title || "Team Announcement").trim();
    const message = String(body.message || "").trim();
    if (!message) return c.json({ error: "Message is required" }, 400);

    const { createNotification } = await import("./notifications");
    const activeServers = db.query("SELECT id FROM users WHERE role = 'server' AND is_active = 1").all() as { id: string }[];
    for (const server of activeServers) {
      await createNotification(db as any, {
        userId: server.id,
        type: "broadcast",
        priority: "normal",
        title,
        body: message,
        actionUrl: "/dashboard",
      });
    }

    return c.json({ success: true, count: activeServers.length });
  });

  // VAPID Public Key for Web Push
  app.get("/api/push/vapid-public-key", (c: Context) => {
    const key = process.env.VAPID_PUBLIC_KEY || "";
    return c.json({ publicKey: key });
  });

  // Subscribe client device to Web Push
  app.post("/api/push/subscribe", async (c: Context) => {
    const user = getUserOrAdmin(c);
    const body = await c.req.json().catch(() => ({}));
    const endpoint = String(body.endpoint || "").trim();
    const p256dh = String(body.keys?.p256dh || body.p256dh || "").trim();
    const auth = String(body.keys?.auth || body.auth || "").trim();
    const platform = String(body.platform || "browser").trim();
    const userAgent = c.req.header("user-agent") || "";

    if (!endpoint || !p256dh || !auth) {
      return c.json({ error: "Invalid subscription payload" }, 400);
    }

    const id = `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    db.query(`
      INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, platform, user_agent, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        last_seen_at = excluded.last_seen_at
    `).run(id, user.id, endpoint, p256dh, auth, platform, userAgent, now, now);

    return c.json({ success: true });
  });

  // Unsubscribe client device
  app.delete("/api/push/unsubscribe", async (c: Context) => {
    const user = getUserOrAdmin(c);
    const body = await c.req.json().catch(() => ({}));
    const endpoint = String(body.endpoint || "").trim();
    if (endpoint) {
      db.query("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").run(endpoint, user.id);
    }
    return c.json({ success: true });
  });

  // --- Payment & Helcim Invoice Routes ---
  app.post("/api/cases/:id/invoice", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (!user || user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const caseRowDb = db.query("SELECT * FROM client_cases WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!caseRowDb) {
      return c.json({ error: "Case not found" }, 404);
    }
    if (caseRowDb.invoice_id) {
      return c.json({ error: "Conflict: Invoice already attached to this case" }, 409);
    }
    const quotedFee = Number(body.quoted_fee || caseRowDb.quoted_fee || 0);
    if (!quotedFee || quotedFee <= 0) {
      return c.json({ error: "quoted_fee must be a positive number" }, 400);
    }
    const cl = db.query("SELECT * FROM clients WHERE id = ?").get(caseRowDb.client_id as string) as Record<string, unknown> | null;
    if (!cl || !cl.email) {
      return c.json({ error: "Client email is required for invoice creation" }, 400);
    }
    try {
      const inv = await createHelcimInvoice({
        caseNumber: String(caseRowDb.case_number),
        customerName: String(cl.company_name || cl.contact_name || cl.name || "Client"),
        customerEmail: String(cl.email),
        amount: quotedFee,
        notes: String(body.notes || caseRowDb.notes || ""),
      });
      persistInvoiceOnCase(db, id, inv, quotedFee);
      if (body.email_invoice) {
        await maybeEmailInvoice({
          to: String(cl.email),
          caseNumber: String(caseRowDb.case_number),
          amount: quotedFee,
          payUrl: inv.payUrl,
          clientName: String(cl.contact_name || cl.company_name || cl.name || "Client"),
        });
      }
      const updated = db.query("SELECT * FROM client_cases WHERE id = ?").get(id) as Record<string, unknown>;
      return c.json(caseRow(updated, "admin"), 200);
    } catch (err: any) {
      return c.json({ error: err.message || "Failed to create invoice" }, 500);
    }
  });

  app.post("/api/cases/:id/invoice/attach", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (!user || user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const caseRowDb = db.query("SELECT * FROM client_cases WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!caseRowDb) {
      return c.json({ error: "Case not found" }, 404);
    }
    if (caseRowDb.invoice_id) {
      return c.json({ error: "Conflict: Invoice already attached to this case" }, 409);
    }

    const invoiceId = String(body.invoice_id || body.invoiceId || "").trim();
    const invoiceNumber = String(body.invoice_number || body.invoiceNumber || "").trim();
    if (!invoiceId && !invoiceNumber) {
      return c.json({ error: "invoice_id or invoice_number is required" }, 400);
    }

    try {
      const invoice = await fetchHelcimInvoice({ invoiceId, invoiceNumber });
      if (invoice.status === "CANCELLED") {
        return c.json({ error: "Cannot attach a cancelled Helcim invoice" }, 400);
      }

      const conflictCaseId = findCaseByInvoiceId(db, invoice.invoiceId, id);
      const quotedFee = Number(body.quoted_fee || invoice.amount || caseRowDb.quoted_fee || 0);

      if (body.preview === true) {
        return c.json({
          preview: true,
          ...buildAttachPreview(db, id, invoice, quotedFee > 0 ? quotedFee : undefined),
          blocked: conflictCaseId ? "invoice_on_another_case" : null,
        }, conflictCaseId ? 409 : 200);
      }

      if (conflictCaseId) {
        return c.json({
          error: "Invoice already attached to another case",
          conflictCaseId,
        }, 409);
      }

      if (!quotedFee || quotedFee <= 0) {
        return c.json({ error: "quoted_fee must be a positive number" }, 400);
      }

      attachInvoiceOnCase(db, id, invoice, quotedFee);
      const updated = db.query("SELECT * FROM client_cases WHERE id = ?").get(id) as Record<string, unknown>;
      return c.json(caseRow(updated, "admin"), 200);
    } catch (err: any) {
      return c.json({ error: err.message || "Failed to attach invoice" }, 500);
    }
  });

  app.post("/api/cases/:id/invoice/resend-email", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (!user || user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const id = c.req.param("id");
    const caseRowDb = db.query("SELECT * FROM client_cases WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!caseRowDb) {
      return c.json({ error: "Case not found" }, 404);
    }
    if (!caseRowDb.pay_url) {
      return c.json({ error: "No invoice exists for this case" }, 400);
    }
    const cl = db.query("SELECT * FROM clients WHERE id = ?").get(caseRowDb.client_id as string) as Record<string, unknown> | null;
    if (!cl || !cl.email) {
      return c.json({ error: "Client email required" }, 400);
    }
    const res = await maybeEmailInvoice({
      to: String(cl.email),
      caseNumber: String(caseRowDb.case_number),
      amount: Number(caseRowDb.quoted_fee || 0),
      payUrl: String(caseRowDb.pay_url),
      clientName: String(cl.contact_name || cl.company_name || cl.name || "Client"),
    });
    return c.json({ ok: true, success: true, sent: res.sent, skipped: res.skipped });
  });

  app.post("/api/cases/:id/mark-paid", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (!user || user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const caseRowDb = db.query("SELECT * FROM client_cases WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!caseRowDb) {
      return c.json({ error: "Case not found" }, 404);
    }
    const paidAt = body.paid_at || nowIso();
    const method = body.payment_method || "manual";
    const notes = body.payment_notes || "";
    db.query(
      `UPDATE client_cases
       SET payment_status = 'PAID', paid_at = ?, payment_method = ?, payment_notes = ?, updated_at = ?
       WHERE id = ?`
    ).run(paidAt, method, notes, nowIso(), id);
    const updated = db.query("SELECT * FROM client_cases WHERE id = ?").get(id) as Record<string, unknown>;
    return c.json(caseRow(updated, "admin"), 200);
  });

  app.post("/api/cases/:id/mark-unpaid", async (c: Context) => {
    const user = getUserOrAdmin(c);
    if (!user || user.role !== "admin") {
      return c.json({ error: "Forbidden: Admin access required" }, 403);
    }
    const id = c.req.param("id");
    const caseRowDb = db.query("SELECT * FROM client_cases WHERE id = ?").get(id) as Record<string, unknown> | null;
    if (!caseRowDb) {
      return c.json({ error: "Case not found" }, 404);
    }
    db.query(
      `UPDATE client_cases
       SET payment_status = 'UNPAID', paid_at = '', payment_method = '', payment_notes = '', updated_at = ?
       WHERE id = ?`
    ).run(nowIso(), id);
    const updated = db.query("SELECT * FROM client_cases WHERE id = ?").get(id) as Record<string, unknown>;
    return c.json(caseRow(updated, "admin"), 200);
  });

  app.post("/api/webhooks/helcim", async (c: Context) => {
    const secret = c.req.header("x-helcim-webhook-secret");
    const expectedSecret = process.env.HELCIM_WEBHOOK_SECRET || "staging-helcim-webhook-secret";
    if (!secret || secret !== expectedSecret) {
      return c.json({ error: "Unauthorized: Invalid webhook secret" }, 401);
    }
    const body = await c.req.json();
    const invoiceId = body.invoice_id || body.invoiceId;
    if (!invoiceId) {
      return c.json({ error: "Missing invoice_id" }, 400);
    }
    const res = applyPaidWebhook(db, String(invoiceId), body.paid_at);
    if (!res.ok) {
      return c.json({ error: "Invoice not found on any case" }, 404);
    }
    return c.json({ ok: true, caseId: res.caseId, alreadyPaid: res.alreadyPaid });
  });
}

async function deleteServeFiles(imageFileId?: string, thumbnailFileId?: string) {
  for (const item of [imageFileId, thumbnailFileId]) {
    if (!item) continue;
    try {
      const fileName = item.includes("/") ? item.split("/").pop()! : (item.endsWith(".jpg") ? item : `${item}.jpg`);
      await unlink(join(UPLOADS_DIR, "serves", fileName));
    } catch {
      // file may not exist
    }
  }
}

async function deleteDocumentFile(filePath: string) {
  if (!filePath) return;
  try {
    await unlink(join(UPLOADS_DIR, "documents", filePath));
  } catch {
    // file may not exist
  }
}

export function logAuditEvent(db: Db, event: {
  event_type: string;
  actor_user_id?: string;
  actor_role?: string;
  target_resource_id?: string;
  ip_address?: string;
  user_agent?: string;
  details?: Record<string, unknown>;
}) {
  try {
    const id = "aud_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const now = new Date().toISOString();
    db.query(`
      INSERT INTO audit_logs (id, event_type, actor_user_id, actor_role, target_resource_id, ip_address, user_agent, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      event.event_type,
      event.actor_user_id || "",
      event.actor_role || "",
      event.target_resource_id || "",
      event.ip_address || "",
      event.user_agent || "",
      JSON.stringify(event.details || {}),
      now
    );
  } catch (err) {
    console.error("Audit log error:", err);
  }
}

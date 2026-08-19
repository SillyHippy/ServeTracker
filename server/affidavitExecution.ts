import { createHash, randomUUID } from "crypto";
import type { Db } from "./db";
import {
  inferAffidavitKind,
  latestSuccessfulServe,
  type AffidavitKind,
} from "../src/utils/affidavitEngine";

export { inferAffidavitKind, latestSuccessfulServe };
export type { AffidavitKind };

export function newId(): string {
  return randomUUID().replace(/-/g, "");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** License state for process-server credentials. */
export function computeLicenseStatus(
  licenseNumber: unknown,
  licenseJurisdiction: unknown,
  licenseExpiresAt: unknown
): "missing" | "incomplete" | "valid" | "expires_soon" | "expired" {
  const num = String(licenseNumber || "").trim();
  const jur = String(licenseJurisdiction || "").trim();
  const exp = String(licenseExpiresAt || "").trim();
  if (!num) return "missing";
  if (!jur || !exp) return "incomplete";
  const d = new Date(exp + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return "incomplete";
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (d.getTime() < today.getTime()) return "expired";
  const soon = new Date(today);
  soon.setUTCDate(soon.getUTCDate() + 30);
  if (d.getTime() <= soon.getTime()) return "expires_soon";
  return "valid";
}

/** Eligibility gate used by assignment + affidavit signing (v1: deny). */
export function serverEligibilityError(userRow: Record<string, unknown> | null): string | null {
  if (!userRow) return "Server not found";
  if (String(userRow.is_active) !== "1" && userRow.is_active !== 1) return "Server is deactivated";
  if (String(userRow.onboarding_status || "") !== "active") return "Server onboarding is not complete";
  const lic = computeLicenseStatus(
    userRow.license_number,
    userRow.license_jurisdiction,
    userRow.license_expires_at
  );
  if (lic === "missing") return "Server has no license number on file";
  if (lic === "incomplete") return "Server license record is incomplete";
  if (lic === "expired") return "Server license is expired";
  return null;
}

/** Recursively sort object keys so identical data always hashes identically. */
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalize(v)).join(",") + "]";
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      "{" +
      keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") +
      "}"
    );
  }
  return JSON.stringify(value ?? null);
}

/** Resolve a case row by UUID first, then by case_number (active row preferred). */
export function resolveCase(
  db: Db,
  caseIdOrNumber: string,
  clientIdFilter = ""
): Record<string, unknown> | null {
  const caseId = String(caseIdOrNumber || "").trim();
  if (!caseId) return null;

  let caseObj = db.query("SELECT * FROM client_cases WHERE id = ?").get(caseId) as Record<string, unknown> | null;

  if (!caseObj) {
    if (clientIdFilter) {
      caseObj = db
        .query(
          `SELECT * FROM client_cases
           WHERE case_number = ? AND client_id = ?
           ORDER BY CASE WHEN lower(COALESCE(status,'')) IN ('closed','completed') THEN 1 ELSE 0 END ASC,
                    COALESCE(updated_at, created_at) DESC
           LIMIT 1`
        )
        .get(caseId, clientIdFilter) as Record<string, unknown> | null;
    }
    if (!caseObj) {
      caseObj = db
        .query(
          `SELECT * FROM client_cases
           WHERE case_number = ?
           ORDER BY CASE WHEN lower(COALESCE(status,'')) IN ('closed','completed') THEN 1 ELSE 0 END ASC,
                    COALESCE(updated_at, created_at) DESC
           LIMIT 1`
        )
        .get(caseId) as Record<string, unknown> | null;
    }
  }
  return caseObj;
}

/** Active signature asset for a user (status active, not revoked). */
export function activeSignature(db: Db, userId: string): Record<string, unknown> | null {
  return (db
    .query(
      "SELECT * FROM user_signature_assets WHERE user_id = ? AND status = 'active' AND (revoked_at = '' OR revoked_at IS NULL) ORDER BY created_at DESC LIMIT 1"
    )
    .get(userId) as Record<string, unknown> | null);
}

/** Voids every signed-not-notarized execution for a case (kept for audit). */
export function invalidateExecutionsForCase(db: Db, caseId: string, reason: string): number {
  const res = db
    .query(
      `UPDATE affidavit_executions
       SET status = 'void', invalidated_at = ?, invalidation_reason = ?
       WHERE case_id = ? AND status = 'signed_not_notarized' AND (invalidated_at = '' OR invalidated_at IS NULL)`
    )
    .run(nowIso(), reason, caseId);
  return Number(res.changes ?? 0);
}

/** Voids executions on every case currently assigned to a server. */
export function invalidateForServerChanges(db: Db, serverId: string, reason: string): number {
  const cases = db
    .query("SELECT id FROM client_cases WHERE assigned_to = ?")
    .all(serverId) as { id: string }[];
  let n = 0;
  for (const c of cases) n += invalidateExecutionsForCase(db, c.id, reason);
  return n;
}

/** The latest execution row for a case (any status). */
export function latestExecution(db: Db, caseId: string): Record<string, unknown> | null {
  return (db
    .query("SELECT * FROM affidavit_executions WHERE case_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(caseId) as Record<string, unknown> | null);
}

/** The current usable signed execution for a case (not invalidated). */
export function activeExecution(db: Db, caseId: string): Record<string, unknown> | null {
  return (db
    .query(
      "SELECT * FROM affidavit_executions WHERE case_id = ? AND status = 'signed_not_notarized' AND (invalidated_at = '' OR invalidated_at IS NULL) ORDER BY created_at DESC LIMIT 1"
    )
    .get(caseId) as Record<string, unknown> | null);
}

export interface CaseBundle {
  caseObj: Record<string, unknown>;
  client: Record<string, unknown> | null;
  recipients: Record<string, unknown>[];
  attempts: Record<string, unknown>[];
  assignedServer: Record<string, unknown> | null;
  photoCache: Record<string, Record<string, unknown>[]>;
}

/** Load the full affidavit fact bundle for a case (same scoping as /api/affidavit/:caseId). */
export function loadCaseBundle(db: Db, caseIdOrNumber: string, clientIdFilter = ""): CaseBundle | null {
  const caseObj = resolveCase(db, caseIdOrNumber, clientIdFilter);
  if (!caseObj) return null;

  const client = db.query("SELECT * FROM clients WHERE id = ?").get(caseObj.client_id) as Record<string, unknown> | null;
  const recipients = db
    .query("SELECT * FROM serve_recipients WHERE case_id = ?")
    .all(caseObj.id) as Record<string, unknown>[];
  const attempts = db
    .query(
      `SELECT * FROM serve_attempts
       WHERE id IN (
         SELECT id FROM serve_attempts WHERE case_id != '' AND case_id = ?
         UNION
         SELECT id FROM serve_attempts WHERE case_number = ? AND client_id = ?
       )
       ORDER BY COALESCE(occurred_at, timestamp) ASC`
    )
    .all(String(caseObj.id), caseObj.case_number, caseObj.client_id) as Record<string, unknown>[];

  let assignedServer: Record<string, unknown> | null = null;
  const assignedTo = String(caseObj.assigned_to || "");
  if (assignedTo) {
    assignedServer = db.query("SELECT * FROM users WHERE id = ?").get(assignedTo) as Record<string, unknown> | null;
  }

  // Photos per attempt (material exhibits must be part of the hashed snapshot).
  const photoCache: Record<string, Record<string, unknown>[]> = {};
  for (const a of attempts) {
    photoCache[String(a.id)] = db
      .query(
        "SELECT id, position, image_url, image_file_id, thumbnail_url, label, captured_at, coordinates FROM serve_attempt_photos WHERE serve_id = ? ORDER BY position ASC"
      )
      .all(a.id) as Record<string, unknown>[];
  }

  return { caseObj, client, recipients, attempts, assignedServer, photoCache };
}

/** Canonical sorted-key snapshot of every material fact on the affidavit. */
export function buildSourceSnapshot(
  bundle: CaseBundle,
  signatureAsset: Record<string, unknown> | null,
  affidavitKind?: AffidavitKind | string | null,
  venue?: { state?: string; county?: string } | null
): string {
  const c = bundle.caseObj;
  const snapshot = {
    case: {
      id: c.id,
      case_number: c.case_number,
      case_name: c.case_name,
      court_name: c.court_name,
      plaintiff_petitioner: c.plaintiff_petitioner,
      defendant_respondent: c.defendant_respondent,
      home_address: c.home_address,
      work_address: c.work_address,
      documents_to_serve: c.documents_to_serve,
      notes: c.notes,
      status: c.status,
      assigned_to: c.assigned_to,
      assigned_name: c.assigned_name,
    },
    client: bundle.client
      ? {
          id: bundle.client.id,
          name: bundle.client.name,
          email: bundle.client.email,
          phone: bundle.client.phone,
          address: bundle.client.address,
        }
      : null,
    recipients: bundle.recipients.map((r) => ({
      id: r.id,
      full_name: r.full_name,
      role: r.role,
      description: r.description,
      status: r.status,
      home_address: r.home_address,
      work_address: r.work_address,
      notes: r.notes,
    })),
    attempts: bundle.attempts.map((a) => ({
      id: a.id,
      case_number: a.case_number,
      person_being_served: a.person_being_served,
      status: a.status,
      notes: a.notes,
      address: a.address,
      service_address: a.service_address,
      coordinates: a.coordinates,
      occurred_at: a.occurred_at || a.timestamp,
      attempt_number: a.attempt_number,
      attempt_type: a.attempt_type,
      contact_person: a.contact_person,
      result_detail: a.result_detail,
      physical_description: a.physical_description,
      service_method: a.service_method,
      accepted_by: a.accepted_by,
      logged_by: a.logged_by,
      photos: ((bundle.photoCache[a.id as string] as Record<string, unknown>[]) || []).map((p) => ({
        id: p.id,
        position: p.position,
        image_url: p.image_url,
        label: p.label,
        captured_at: p.captured_at,
        coordinates: p.coordinates,
      })),
    })),
    assignedServer: bundle.assignedServer
      ? {
          id: bundle.assignedServer.id,
          legal_name: bundle.assignedServer.legal_name,
          display_name: bundle.assignedServer.display_name,
          license_number: bundle.assignedServer.license_number,
          license_jurisdiction: bundle.assignedServer.license_jurisdiction,
          license_expires_at: bundle.assignedServer.license_expires_at,
        }
      : null,
    signature: signatureAsset
      ? {
          asset_id: signatureAsset.id,
          sha256: signatureAsset.sha256,
          mime_type: signatureAsset.mime_type,
        }
      : null,
    affidavitKind: inferAffidavitKind(bundle.attempts, affidavitKind),
    notaryVenue: {
      state: String(venue?.state || "OKLAHOMA").trim().toUpperCase() || "OKLAHOMA",
      county: String(venue?.county || "").trim().toUpperCase(),
    },
  };
  return canonicalize(snapshot);
}

/** True when a Service affidavit would assert a method that was never recorded. */
export function methodBlockingError(
  attempts: Record<string, unknown>[],
  kind?: AffidavitKind | string | null
): string | null {
  const resolved = inferAffidavitKind(attempts, kind);
  if (resolved === "non-service") return null;
  const last = latestSuccessfulServe(attempts);
  if (!last) {
    return "METHOD NOT RECORDED — verify the method of service before signing.";
  }
  const method = String((last as { service_method?: string }).service_method || "").trim();
  if (!method || method.toLowerCase() === "non-service") {
    return "METHOD NOT RECORDED — verify the method of service before signing.";
  }
  return null;
}

export interface SignValidation {
  ok: boolean;
  error?: string;
  bundle?: CaseBundle;
  signature?: Record<string, unknown> | null;
}

/** All checks that must pass before a signature can be applied. */
export function validateSignable(
  db: Db,
  caseIdOrNumber: string,
  _actorRole?: "admin" | "server",
  affidavitKind?: AffidavitKind | string | null
): SignValidation {
  const bundle = loadCaseBundle(db, caseIdOrNumber);
  if (!bundle) return { ok: false, error: "Case not found" };

  const assigned = bundle.assignedServer;
  if (!assigned) return { ok: false, error: "Case is not assigned to a field server" };
  const eligibility = serverEligibilityError(assigned);
  if (eligibility) return { ok: false, error: eligibility };

  const methodErr = methodBlockingError(bundle.attempts, affidavitKind);
  if (methodErr) return { ok: false, error: methodErr };

  const sig = activeSignature(db, String(assigned.id));
  if (!sig) return { ok: false, error: "Assigned server has no active saved signature" };

  return { ok: true, bundle, signature: sig };
}

export function createExecution(
  db: Db,
  opts: {
    caseId: string;
    clientId: string;
    assignedServerId: string;
    signedByUserId: string;
    appliedByUserId: string;
    applicationMode: "server_self" | "admin_on_behalf";
    sourceSnapshotJson: string;
    sourceHash: string;
    renderedHash: string;
    supersedesExecutionId?: string;
  }
): Record<string, unknown> {
  const id = "exe_" + newId();
  const ts = nowIso();
  db.query(
    `INSERT INTO affidavit_executions (
      id, case_id, client_id, assigned_server_id, signed_by_user_id, applied_by_user_id,
      application_mode, status, source_snapshot_json, source_hash, rendered_hash,
      supersedes_execution_id, invalidated_at, invalidation_reason, created_at, signed_at, finalized_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'signed_not_notarized', ?, ?, ?, ?, '', '', ?, ?, '')`
  ).run(
    id,
    opts.caseId,
    opts.clientId,
    opts.assignedServerId,
    opts.signedByUserId,
    opts.appliedByUserId,
    opts.applicationMode,
    opts.sourceSnapshotJson,
    opts.sourceHash,
    opts.renderedHash,
    opts.supersedesExecutionId || "",
    ts,
    ts
  );
  return db.query("SELECT * FROM affidavit_executions WHERE id = ?").get(id) as Record<string, unknown>;
}

/** Render the signed affidavit HTML with the execution's signature embedded. */
export async function renderExecutionHtml(
  db: Db,
  execution: Record<string, unknown>
): Promise<{ html: string; dataUrl: string } | null> {
  const bundle = loadCaseBundle(db, String(execution.case_id));
  if (!bundle) return null;

  let snapshot: Record<string, unknown> = {};
  try {
    snapshot = JSON.parse(String(execution.source_snapshot_json || "{}"));
  } catch {
    // fall through with empty snapshot
  }

  const sigRef = (snapshot.signature as Record<string, unknown>) || null;
  let dataUrl = "";
  if (sigRef && sigRef.asset_id) {
    const asset = db.query("SELECT * FROM user_signature_assets WHERE id = ?").get(sigRef.asset_id) as
      | Record<string, unknown>
      | null;
    if (asset && asset.storage_key) {
      try {
        const { readFile } = await import("fs/promises");
        const { join } = await import("path");
        const { SIGNATURES_DIR } = await import("./signatures");
        const buf = await readFile(join(SIGNATURES_DIR, String(asset.storage_key)));
        const mime = String(asset.mime_type || "image/png");
        dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
      } catch {
        dataUrl = "";
      }
    }
  }

  const { generateAffidavitHtml } = await import("../src/utils/affidavitEngine");
  const server = bundle.assignedServer || {};
  const c = bundle.caseObj;
  const recipientName =
    bundle.recipients[0]?.full_name || c.defendant_respondent || c.case_name || "TARGET RECIPIENT";

  const venue = ((snapshot.notaryVenue as Record<string, unknown>) || {}) as {
    state?: string;
    county?: string;
  };
  const venueState = String(venue.state || "OKLAHOMA").trim().toUpperCase() || "OKLAHOMA";
  const venueCounty = String(venue.county || "").trim().toUpperCase() || "TULSA";

  const html = generateAffidavitHtml({
    case: {
      case_number: String(c.case_number || ""),
      case_name: String(c.case_name || ""),
      court_name: String(c.court_name || ""),
      plaintiff_petitioner: String(c.plaintiff_petitioner || ""),
      defendant_respondent: String(c.defendant_respondent || ""),
      documents_to_serve: String(c.documents_to_serve || ""),
    },
    client: bundle.client ? { name: String(bundle.client.name || "") } : undefined,
    recipient: {
      full_name: String(recipientName || ""),
      home_address: String(c.home_address || ""),
      work_address: String(c.work_address || ""),
    },
    attempts: bundle.attempts.map((a) => ({ ...a })) as any,
    swornDate: new Date(String(execution.signed_at || new Date().toISOString())),
    notaryBlock: {
      serverName: String(server.legal_name || server.display_name || "Process Server"),
      licenseNumber: String(server.license_number || ""),
      state: venueState,
      county: venueCounty,
    },
    signature: dataUrl ? { dataUrl, mimeType: String((sigRef && sigRef.mime_type) || "image/png") } : undefined,
    affidavitKind: inferAffidavitKind(
      bundle.attempts,
      snapshot.affidavitKind as string | undefined
    ),
  });

  return { html, dataUrl };
}

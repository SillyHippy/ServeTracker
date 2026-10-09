#!/usr/bin/env bun
/**
 * Generate a ServeTracker-native field sheet PDF from a case id or case number.
 * Usage:
 *   bun scripts/generate_field_sheet_cli.ts --case-number FD-2026-1091 --out /path/to/out.pdf
 *   bun scripts/generate_field_sheet_cli.ts --case-id e3886b4f56ad4d90add1b86dd7d0d374 --out /path/to/out.pdf
 *   bun scripts/generate_field_sheet_cli.ts --case-number X --server "Bill Acox" --out /path/to/out.pdf
 */
import { Database } from "bun:sqlite";
import { generateFieldSheetPdf } from "../src/utils/fieldSheetPdfEngine";
import type { FieldSheetPayload } from "../src/utils/fieldSheetEngine";
import { join } from "path";

const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const caseNumber = getArg("case-number");
const caseId = getArg("case-id");
const outPath = getArg("out");
const serverArg = getArg("server");
const dbPath = getArg("db") || join(import.meta.dir, "../data/pdfusaedit.db");

if (!outPath || (!caseNumber && !caseId)) {
  console.error("Usage: bun scripts/generate_field_sheet_cli.ts --case-number CASE# --out /path/to.pdf [--server NAME]");
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
const row = caseId
  ? db.query(`SELECT cc.*, c.name AS client_name, c.phone AS client_phone
      FROM client_cases cc JOIN clients c ON cc.client_id = c.id WHERE cc.id = ?`).get(caseId)
  : db.query(`SELECT cc.*, c.name AS client_name, c.phone AS client_phone
      FROM client_cases cc JOIN clients c ON cc.client_id = c.id
      WHERE cc.case_number = ?
        AND lower(coalesce(cc.status,'')) NOT IN ('closed','void','cancelled')
      ORDER BY cc.updated_at DESC LIMIT 1`).get(caseNumber);

if (!row) {
  console.error("Case not found");
  process.exit(1);
}

const r = row as Record<string, unknown>;
const caseRowId = String(r.id ?? "");
const recipients = caseRowId
  ? (db.query(`SELECT full_name, role, personal_service_only FROM serve_recipients WHERE case_id = ?`).all(caseRowId) as Array<{
      full_name: string;
      role?: string;
      personal_service_only?: number;
    }>)
  : [];

const assignedFromDb = String(r.assigned_name ?? "").trim();
const assignedServer = (serverArg && serverArg.trim()) || assignedFromDb || "Unassigned";

const payload: FieldSheetPayload = {
  caseNumber: String(r.case_number ?? ""),
  caseName: String(r.case_name ?? r.defendant_respondent ?? ""),
  courtName: String(r.court_name ?? ""),
  plaintiff: String(r.plaintiff_petitioner ?? ""),
  defendant: String(r.defendant_respondent ?? ""),
  personToServe: String(r.defendant_respondent ?? r.case_name ?? ""),
  documents: String(r.documents_to_serve ?? ""),
  requirements: String(r.service_requirements ?? ""),
  notes: String(r.notes ?? ""),
  contactInfo: String(r.contact_info ?? ""),
  homeAddress: String(r.home_address ?? ""),
  workAddress: String(r.work_address ?? ""),
  clientName: String(r.client_name ?? ""),
  clientPhone: String(r.client_phone ?? ""),
  serviceLevel: String(r.service_level ?? "standard"),
  recipients: recipients.map((rec) => ({
    full_name: String(rec.full_name ?? ""),
    role: String(rec.role ?? ""),
    personal_service_only: Number(rec.personal_service_only || 0) === 1,
  })),
  assignedServer,
};

const pdf = await generateFieldSheetPdf(payload);
await Bun.write(outPath, pdf);
console.log(JSON.stringify({
  ok: true,
  bytes: pdf.length,
  out: outPath,
  caseNumber: payload.caseNumber,
  assignedServer,
  serviceLevel: payload.serviceLevel,
}));

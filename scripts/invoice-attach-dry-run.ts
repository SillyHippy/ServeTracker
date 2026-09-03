#!/usr/bin/env bun
/**
 * Read-only dry-run: match Helcim invoices to ServeTracker cases.
 * Staging only — never writes to DB or creates Helcim invoices.
 *
 * Usage:
 *   HELCIM_MOCK=true bun scripts/invoice-attach-dry-run.ts
 *   DATA_DIR=/path/to/staging bun scripts/invoice-attach-dry-run.ts
 *   OUT_CSV=/tmp/matches.csv bun scripts/invoice-attach-dry-run.ts
 */

import { Database } from "bun:sqlite";
import { join } from "path";
import { writeFileSync, readFileSync } from "fs";

const DATA_DIR = process.env.DATA_DIR || join(import.meta.dir, "..", "data");
const DB_PATH = join(DATA_DIR, "pdfusaedit.db");
const OUT_CSV = process.env.OUT_CSV || join(DATA_DIR, "invoice-attach-dry-run.csv");

type CaseRow = {
  id: string;
  case_number: string;
  client_id: string;
  invoice_id: string;
  payment_status: string;
  notes: string;
};

type ClientRow = {
  id: string;
  name: string;
  email: string;
};

type Match = {
  caseId: string;
  caseNumber: string;
  clientEmail: string;
  invoiceId: string;
  invoiceNumber: string;
  helcimStatus: string;
  paymentStatus: string;
  amount: number;
  confidence: "HIGH" | "MEDIUM" | "REVIEW" | "SKIP";
  reason: string;
};

function extractInvFromNotes(notes: string): string | null {
  const m = notes.match(/\b(INV\d{4,})\b/i);
  return m ? m[1].toUpperCase() : null;
}

function extractCaseNumbers(text: string): string[] {
  const hits = new Set<string>();
  const re = /\b([A-Z]{1,4}-\d{2,4}-[\w-]+)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    hits.add(m[1].toUpperCase());
  }
  // Also match bare court-style numbers like PG-26-22, CJ-2026-03309
  const re2 = /\b([A-Z]{2,4}-\d{2,}-\d+)\b/gi;
  while ((m = re2.exec(text)) !== null) {
    hits.add(m[1].toUpperCase());
  }
  return [...hits];
}

function invoiceText(inv: Record<string, unknown>): string {
  const parts: string[] = [
    String(inv.notes || ""),
    String(inv.invoiceNumber || ""),
  ];
  const items = inv.lineItems;
  if (Array.isArray(items)) {
    for (const li of items) {
      if (li && typeof li === "object") {
        parts.push(String((li as Record<string, unknown>).description || ""));
      }
    }
  }
  const ba = inv.billingAddress;
  if (ba && typeof ba === "object") {
    parts.push(String((ba as Record<string, unknown>).email || ""));
  }
  return parts.join(" ");
}

function mapHelcimStatus(status: string): string {
  const s = String(status || "").toUpperCase();
  if (s === "PAID" || s === "COMPLETED") return "PAID";
  if (s === "CANCELLED") return "CANCELLED";
  return "UNPAID";
}

async function listHelcimInvoicesLive(token: string): Promise<Array<Record<string, unknown>>> {
  const all: Array<Record<string, unknown>> = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`https://api.helcim.com/v2/invoices/?page=${page}`, {
      headers: {
        "api-token": token,
        Accept: "application/json",
      },
    });
    if (!res.ok) break;
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

function readHelcimToken(): string {
  return String(process.env.HELCIM_API_TOKEN || "").replace(/\\/g, "").trim();
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  const db = new Database(DB_PATH, { readonly: true });
  const cases = db.query(
    "SELECT id, case_number, client_id, invoice_id, payment_status, notes FROM client_cases",
  ).all() as CaseRow[];
  const clients = db.query("SELECT id, name, email FROM clients").all() as ClientRow[];
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const casesByNumber = new Map<string, CaseRow[]>();
  for (const c of cases) {
    const key = c.case_number.toUpperCase();
    const list = casesByNumber.get(key) || [];
    list.push(c);
    casesByNumber.set(key, list);
  }
  const casesByClient = new Map<string, CaseRow[]>();
  for (const c of cases) {
    const list = casesByClient.get(c.client_id) || [];
    list.push(c);
    casesByClient.set(c.client_id, list);
  }

  const blankCases = cases.filter((c) => !c.invoice_id);
  const mock = process.env.HELCIM_MOCK === "true" || (!process.env.HELCIM_MOCK && !readHelcimToken());

  console.log(`DB: ${DB_PATH}`);
  console.log(`Cases: ${cases.length} total, ${blankCases.length} without invoice_id`);
  console.log(`HELCIM_MOCK=${mock}`);
  console.log("");

  const matches: Match[] = [];
  const matchedCaseIds = new Set<string>();
  const matchedInvoiceIds = new Set<string>();

  // Tier 1: INV# in notes
  for (const c of blankCases) {
    const invNum = extractInvFromNotes(c.notes || "");
    if (!invNum) continue;
    const cl = clientById.get(c.client_id);
    matches.push({
      caseId: c.id,
      caseNumber: c.case_number,
      clientEmail: cl?.email || "",
      invoiceId: "",
      invoiceNumber: invNum,
      helcimStatus: "",
      paymentStatus: "",
      amount: 0,
      confidence: "HIGH",
      reason: "INV# in case notes",
    });
    matchedCaseIds.add(c.id);
  }

  let helcimInvoices: Array<Record<string, unknown>> = [];
  if (!mock) {
    const token = readHelcimToken();
    if (!token) {
      console.log("WARN: No Helcim token — skipping case-number tier");
    } else {
      console.log("Fetching Helcim invoices (read-only)...");
      helcimInvoices = await listHelcimInvoicesLive(token);
      console.log(`Helcim invoices fetched: ${helcimInvoices.length}`);
      console.log("");

      const invByNumber = new Map<string, Record<string, unknown>>();
      for (const inv of helcimInvoices) {
        const num = String(inv.invoiceNumber || "").toUpperCase();
        if (num) invByNumber.set(num, inv);
      }

      // Resolve HIGH note matches to invoice IDs
      for (const m of matches) {
        if (m.confidence !== "HIGH" || !m.invoiceNumber) continue;
        const inv = invByNumber.get(m.invoiceNumber);
        if (!inv) continue;
        m.invoiceId = String(inv.invoiceId || inv.id || "");
        m.helcimStatus = String(inv.status || "");
        m.paymentStatus = mapHelcimStatus(m.helcimStatus);
        m.amount = Number(inv.amount || 0);
        if (m.invoiceId) matchedInvoiceIds.add(m.invoiceId);
      }

      // Tier 2: case number in Helcim line items / notes
      for (const inv of helcimInvoices) {
        const invoiceId = String(inv.invoiceId || inv.id || "");
        if (!invoiceId || matchedInvoiceIds.has(invoiceId)) continue;
        const status = String(inv.status || "").toUpperCase();
        if (status === "CANCELLED") continue;

        const text = invoiceText(inv);
        const caseNums = extractCaseNumbers(text);
        if (caseNums.length === 0) continue;

        const ba = inv.billingAddress as Record<string, unknown> | undefined;
        const invEmail = String(ba?.email || "").toLowerCase().trim();

        for (const cn of caseNums) {
          const caseRows = (casesByNumber.get(cn) || []).filter((r) => !r.invoice_id);
          if (caseRows.length === 0) continue;

          if (caseRows.length > 1) {
            for (const c of caseRows) {
              if (matchedCaseIds.has(c.id)) continue;
              const cl = clientById.get(c.client_id);
              matches.push({
                caseId: c.id,
                caseNumber: c.case_number,
                clientEmail: cl?.email || "",
                invoiceId,
                invoiceNumber: String(inv.invoiceNumber || ""),
                helcimStatus: status,
                paymentStatus: mapHelcimStatus(status),
                amount: Number(inv.amount || 0),
                confidence: "REVIEW",
                reason: `Duplicate case number ${cn} (${caseRows.length} blank rows)`,
              });
            }
            continue;
          }

          const c = caseRows[0];
          if (matchedCaseIds.has(c.id)) continue;
          const cl = clientById.get(c.client_id);
          const clientEmail = (cl?.email || "").toLowerCase().trim();
          const emailMatch = !invEmail || !clientEmail || invEmail === clientEmail;
          const clientCaseCount = (casesByClient.get(c.client_id) || []).filter((r) => !r.invoice_id).length;

          let confidence: Match["confidence"] = "MEDIUM";
          let reason = `Case number ${cn} in Helcim line item`;
          if (!emailMatch) {
            confidence = "REVIEW";
            reason = `Case # match but email mismatch (Helcim ${invEmail} vs client ${clientEmail})`;
          } else if (clientCaseCount > 1) {
            confidence = "REVIEW";
            reason = `Case # match but client has ${clientCaseCount} blank cases`;
          }

          matches.push({
            caseId: c.id,
            caseNumber: c.case_number,
            clientEmail: cl?.email || "",
            invoiceId,
            invoiceNumber: String(inv.invoiceNumber || ""),
            helcimStatus: status,
            paymentStatus: mapHelcimStatus(status),
            amount: Number(inv.amount || 0),
            confidence,
            reason,
          });
          matchedCaseIds.add(c.id);
          matchedInvoiceIds.add(invoiceId);
          break;
        }
      }
    }
  }

  const byConf = {
    HIGH: matches.filter((m) => m.confidence === "HIGH"),
    MEDIUM: matches.filter((m) => m.confidence === "MEDIUM"),
    REVIEW: matches.filter((m) => m.confidence === "REVIEW"),
  };

  console.log(`Matches: ${matches.length} total`);
  console.log(`  HIGH: ${byConf.HIGH.length}`);
  console.log(`  MEDIUM: ${byConf.MEDIUM.length}`);
  console.log(`  REVIEW: ${byConf.REVIEW.length}`);
  console.log("");

  for (const tier of ["HIGH", "MEDIUM", "REVIEW"] as const) {
    const rows = byConf[tier];
    if (rows.length === 0) continue;
    console.log(`--- ${tier} ---`);
    for (const m of rows) {
      console.log(
        `  ${m.caseNumber} -> ${m.invoiceNumber || m.invoiceId} (${m.paymentStatus || "?"}) ${m.reason}`,
      );
    }
    console.log("");
  }

  const emailOnly: Array<{ email: string; caseCount: number }> = [];
  for (const cl of clients) {
    const rows = casesByClient.get(cl.id) || [];
    const blanks = rows.filter((r) => !r.invoice_id);
    if (blanks.length > 1 && cl.email) {
      emailOnly.push({ email: cl.email, caseCount: blanks.length });
    }
  }
  console.log(`Clients with 2+ blank cases (email-only unsafe): ${emailOnly.length}`);

  const dupCourt = new Map<string, number>();
  for (const c of cases) {
    dupCourt.set(c.case_number, (dupCourt.get(c.case_number) || 0) + 1);
  }
  const dups = [...dupCourt.entries()].filter(([, n]) => n > 1);
  console.log(`Duplicate case numbers: ${dups.length}`);
  console.log("");

  const csvLines = [
    "confidence,case_number,case_id,client_email,invoice_id,invoice_number,helcim_status,payment_status,amount,reason",
    ...matches.map((m) => [
      m.confidence,
      m.caseNumber,
      m.caseId,
      m.clientEmail,
      m.invoiceId,
      m.invoiceNumber,
      m.helcimStatus,
      m.paymentStatus,
      String(m.amount),
      m.reason,
    ].map(csvEscape).join(",")),
  ];
  writeFileSync(OUT_CSV, csvLines.join("\n") + "\n");
  console.log(`CSV written: ${OUT_CSV}`);
  console.log("Dry-run complete. No database writes.");
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

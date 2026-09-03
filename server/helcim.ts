import { createHmac, randomUUID } from "crypto";
import type { Db } from "./db";
import { sendEmail } from "./email";

export type InvoiceStatus = "UNPAID" | "PAID" | "CANCELLED" | "";

const HELCIM_API_BASE = "https://api.helcim.com/v2";
const HELCIM_PAY_URL_BASE = "https://just-legal-solutions.myhelcim.com/order/?token=";

export function getHelcimToken(): string {
  return String(process.env.HELCIM_API_TOKEN || "").replace(/\\/g, "").trim();
}

export function isHelcimMock(): boolean {
  if (process.env.HELCIM_MOCK === "false") return false;
  if (process.env.HELCIM_MOCK === "true") return true;
  return !getHelcimToken();
}

export function webhookSecret(): string {
  return process.env.HELCIM_WEBHOOK_SECRET || "staging-helcim-webhook-secret";
}

export function verifyWebhookSecret(header: string | undefined): boolean {
  const expected = webhookSecret();
  if (!header) return false;
  return header === expected || header === `Bearer ${expected}`;
}

export function verifyWebhookHmac(rawBody: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const digest = createHmac("sha256", webhookSecret()).update(rawBody).digest("hex");
  return signature === digest || signature === `sha256=${digest}`;
}

export interface HelcimInvoiceResult {
  invoiceId: string;
  invoiceNumber: string;
  payUrl: string;
  status: InvoiceStatus;
  mock: boolean;
}

function mockToken(): string {
  return randomUUID().replace(/-/g, "");
}

async function helcimApiRequest<T = any>(
  method: string,
  path: string,
  data?: unknown,
  token?: string
): Promise<T> {
  const apiToken = (token || getHelcimToken()).replace(/\\/g, "").trim();
  const res = await fetch(`${HELCIM_API_BASE}${path}`, {
    method,
    headers: {
      "api-token": apiToken,
      "Accept": "application/json",
      "Content-Type": "application/json",
      "User-Agent": "ZoComputer/1.0",
    },
    body: data ? JSON.stringify(data) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Helcim API error (${res.status}): ${text}`);
  }

  return res.json() as Promise<T>;
}

async function findOrCreateCustomerId(name: string, email: string, token: string): Promise<number | undefined> {
  try {
    const custs = await helcimApiRequest<any[]>("GET", `/customers/?contactName=${encodeURIComponent(name || email)}`, undefined, token);
    if (Array.isArray(custs) && custs.length > 0) {
      const match = custs.find((c) => {
        const cEmail = c?.billingAddress?.email || c?.shippingAddress?.email || "";
        return cEmail.toLowerCase().trim() === email.toLowerCase().trim();
      }) || custs[0];
      if (match?.customerId || match?.id) {
        return Number(match.customerId || match.id);
      }
    }
  } catch (err) {
    console.warn("[Helcim] Customer lookup warning:", err);
  }
  return undefined;
}

function makeAddress(name: string, email: string, phone = "5393676832") {
  const digits = (phone || "").replace(/\D/g, "").slice(0, 16) || "5393676832";
  return {
    name: name || email || "Customer",
    street1: "N/A",
    street2: "",
    city: "Tulsa",
    province: "OK",
    country: "USA",
    postalCode: "74103",
    phone: digits,
    email: email.trim(),
  };
}

export async function createHelcimInvoice(opts: {
  customerName: string;
  customerEmail: string;
  amount: number;
  caseNumber: string;
  notes?: string;
}): Promise<HelcimInvoiceResult> {
  const amount = Number(opts.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("quoted_fee must be a positive number");
  }
  if (!opts.customerEmail) {
    throw new Error("client email is required to create an invoice");
  }

  // If in Mock mode or no API token configured
  if (isHelcimMock()) {
    const token = mockToken();
    const invoiceId = `mock_${token.slice(0, 16)}`;
    const invoiceNumber = `MOCK-${Date.now().toString(36).toUpperCase()}`;
    return {
      invoiceId,
      invoiceNumber,
      payUrl: `https://mock.helcim.test/order/?token=${token}`,
      status: "UNPAID",
      mock: true,
    };
  }

  // Real Helcim API integration
  const apiToken = getHelcimToken();
  const customerId = await findOrCreateCustomerId(opts.customerName, opts.customerEmail, apiToken);

  const address = makeAddress(opts.customerName, opts.customerEmail);

  const lineItems = [
    {
      description: `Process Service - Case ${opts.caseNumber || "New"}`,
      quantity: 1,
      price: round2(amount),
      total: round2(amount),
    },
  ];

  const payload: Record<string, unknown> = {
    currency: "USD",
    status: "DUE",
    type: "INVOICE",
    amount: round2(amount),
    lineItems,
    billingAddress: address,
    shipping: { amount: 0, details: "N/A", address },
    notes: opts.notes || `Process Service Case ${opts.caseNumber}`,
  };

  if (customerId) {
    payload.customerId = customerId;
  }

  const result = await helcimApiRequest<any>("POST", "/invoices/", payload, apiToken);
  const invoiceId = String(result.invoiceId || result.id || "");
  const invoiceNumber = String(result.invoiceNumber || "");
  const token = String(result.token || "");

  if (!token) {
    throw new Error("Helcim API response missing payment token");
  }

  const payUrl = `${HELCIM_PAY_URL_BASE}${encodeURIComponent(token)}`;

  return {
    invoiceId,
    invoiceNumber,
    payUrl,
    status: "UNPAID",
    mock: false,
  };
}

function round2(num: number): number {
  return Math.round(num * 100) / 100;
}

export function persistInvoiceOnCase(
  db: Db,
  caseId: string,
  invoice: HelcimInvoiceResult,
  quotedFee: number,
) {
  const ts = new Date().toISOString();
  db.query(
    `UPDATE client_cases
     SET quoted_fee = ?, invoice_id = ?, invoice_number = ?, pay_url = ?,
         payment_status = ?, paid_at = '', invoice_email_sent = 0, updated_at = ?
     WHERE id = ?`,
  ).run(
    String(quotedFee),
    invoice.invoiceId,
    invoice.invoiceNumber,
    invoice.payUrl,
    invoice.status,
    ts,
    caseId,
  );
}

export function mapHelcimRawStatus(status: string): InvoiceStatus {
  const s = String(status || "").toUpperCase();
  if (s === "PAID" || s === "COMPLETED") return "PAID";
  if (s === "CANCELLED") return "CANCELLED";
  return "UNPAID";
}

export interface HelcimInvoiceDetails extends HelcimInvoiceResult {
  amount: number;
  datePaid?: string;
}

function parseHelcimInvoicePayload(result: Record<string, unknown>): HelcimInvoiceDetails {
  const invoiceId = String(result.invoiceId || result.id || "");
  const invoiceNumber = String(result.invoiceNumber || "");
  const token = String(result.token || "");
  const rawStatus = String(result.status || "");
  const amount = Number(result.amount || result.total || 0);
  const datePaid = result.datePaid ? String(result.datePaid) : undefined;
  const payUrl = token
    ? `${HELCIM_PAY_URL_BASE}${encodeURIComponent(token)}`
    : String(result.payUrl || "");

  return {
    invoiceId,
    invoiceNumber,
    payUrl,
    status: mapHelcimRawStatus(rawStatus),
    mock: false,
    amount: Number.isFinite(amount) ? amount : 0,
    datePaid,
  };
}

export async function fetchHelcimInvoice(opts: {
  invoiceId?: string;
  invoiceNumber?: string;
}): Promise<HelcimInvoiceDetails> {
  const invoiceId = String(opts.invoiceId || "").trim();
  const invoiceNumber = String(opts.invoiceNumber || "").trim();

  if (!invoiceId && !invoiceNumber) {
    throw new Error("invoice_id or invoice_number is required");
  }

  if (isHelcimMock()) {
    const key = invoiceId || invoiceNumber;
    const token = mockToken();
    const isPaid = /paid/i.test(key);
    return {
      invoiceId: invoiceId || `mock_${key.replace(/\W/g, "").slice(0, 16)}`,
      invoiceNumber: invoiceNumber || `MOCK-${key.slice(-8).toUpperCase()}`,
      payUrl: `https://mock.helcim.test/order/?token=${token}`,
      status: isPaid ? "PAID" : "UNPAID",
      mock: true,
      amount: 100,
      datePaid: isPaid ? "2026-08-29T00:00:00.000Z" : undefined,
    };
  }

  if (invoiceId) {
    const result = await helcimApiRequest<Record<string, unknown>>("GET", `/invoices/${invoiceId}`);
    return parseHelcimInvoicePayload(result);
  }

  const listed = await helcimApiRequest<Record<string, unknown>[]>(
    "GET",
    `/invoices/?invoiceNumber=${encodeURIComponent(invoiceNumber)}`,
  );
  if (!Array.isArray(listed) || listed.length === 0) {
    throw new Error(`Helcim invoice not found: ${invoiceNumber}`);
  }
  return parseHelcimInvoicePayload(listed[0] as Record<string, unknown>);
}

export function findCaseByInvoiceId(
  db: Db,
  invoiceId: string,
  excludeCaseId?: string,
): string | null {
  const row = db
    .query("SELECT id FROM client_cases WHERE invoice_id = ?")
    .get(invoiceId) as { id: string } | null;
  if (!row) return null;
  if (excludeCaseId && row.id === excludeCaseId) return null;
  return row.id;
}

export function attachInvoiceOnCase(
  db: Db,
  caseId: string,
  invoice: HelcimInvoiceDetails,
  quotedFee?: number,
) {
  const fee = quotedFee ?? invoice.amount ?? 0;
  const paymentStatus = invoice.status === "CANCELLED" ? "" : invoice.status;
  const paidAt = paymentStatus === "PAID"
    ? (invoice.datePaid || new Date().toISOString())
    : "";
  const ts = new Date().toISOString();

  db.query(
    `UPDATE client_cases
     SET quoted_fee = ?, invoice_id = ?, invoice_number = ?, pay_url = ?,
         payment_status = ?, paid_at = ?, invoice_email_sent = 0, updated_at = ?
     WHERE id = ?`,
  ).run(
    String(fee),
    invoice.invoiceId,
    invoice.invoiceNumber,
    invoice.payUrl,
    paymentStatus,
    paidAt,
    ts,
    caseId,
  );
}

export function buildAttachPreview(
  db: Db,
  caseId: string,
  invoice: HelcimInvoiceDetails,
  quotedFee?: number,
) {
  const caseRow = db
    .query("SELECT * FROM client_cases WHERE id = ?")
    .get(caseId) as Record<string, unknown> | null;
  const conflictCaseId = findCaseByInvoiceId(db, invoice.invoiceId, caseId);
  const fee = quotedFee ?? invoice.amount ?? Number(caseRow?.quoted_fee || 0);
  const paymentStatus = invoice.status === "CANCELLED" ? "" : invoice.status;
  const paidAt = paymentStatus === "PAID"
    ? (invoice.datePaid || new Date().toISOString())
    : "";

  return {
    caseId,
    caseNumber: caseRow?.case_number || "",
    current: {
      invoice_id: caseRow?.invoice_id || "",
      invoice_number: caseRow?.invoice_number || "",
      payment_status: caseRow?.payment_status || "",
      quoted_fee: caseRow?.quoted_fee || "",
    },
    proposed: {
      invoice_id: invoice.invoiceId,
      invoice_number: invoice.invoiceNumber,
      payment_status: paymentStatus,
      quoted_fee: String(fee),
      paid_at: paidAt,
      pay_url: invoice.payUrl,
      mock: invoice.mock,
    },
    conflict: conflictCaseId ? { caseId: conflictCaseId } : null,
  };
}

export async function maybeEmailInvoice(opts: {
  to: string;
  caseNumber: string;
  amount: number;
  payUrl: string;
  clientName: string;
}): Promise<{ sent: boolean; skipped: boolean }> {
  if (process.env.DISABLE_EMAIL === "true" || process.env.MOCK_EMAIL === "true") {
    return { sent: false, skipped: true };
  }
  await sendEmail({
    to: opts.to,
    subject: `Invoice for case ${opts.caseNumber}`,
    html: `<p>Hello ${opts.clientName},</p>
<p>Your process-serving invoice for case <strong>${opts.caseNumber}</strong> is ready.</p>
<p>Amount: $${opts.amount.toFixed(2)}</p>
<p><a href="${opts.payUrl}">Pay Invoice Online</a></p>`,
    skipBusinessCopy: true,
  });
  return { sent: true, skipped: false };
}

export function applyPaidWebhook(
  db: Db,
  invoiceId: string,
  paidAt?: string,
): { ok: boolean; alreadyPaid?: boolean; caseId?: string } {
  const row = db
    .query("SELECT id, payment_status, case_number FROM client_cases WHERE invoice_id = ?")
    .get(invoiceId) as { id: string; payment_status?: string; case_number?: string } | null;
  if (!row) return { ok: false };
  if (row.payment_status === "PAID") return { ok: true, alreadyPaid: true, caseId: row.id };
  const ts = paidAt || new Date().toISOString();
  db.query(
    "UPDATE client_cases SET payment_status = 'PAID', paid_at = ?, updated_at = ? WHERE id = ?",
  ).run(ts, new Date().toISOString(), row.id);
  return { ok: true, caseId: row.id };
}

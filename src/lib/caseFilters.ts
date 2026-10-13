export const STILL_ACTIVE = new Set(["active", "on-hold"]);

export type PaymentFilter = "all" | "unpaid" | "paid" | "no_invoice";
export type CaseListMode = "active" | "billing";

export function canonicalStatus(raw?: string): string {
  const s = String(raw || "active").toLowerCase().replace(/[\s_]+/g, "-");
  if (["open", "in-progress", "pending", "active"].includes(s)) return "active";
  if (["served", "completed"].includes(s)) return "served";
  if (["non-service", "nonservice"].includes(s)) return "non-service";
  if (["on-hold", "hold"].includes(s)) return "on-hold";
  if (s === "closed") return "closed";
  return "active";
}

export function parsePaymentFilter(raw?: string | null): PaymentFilter {
  const v = String(raw || "").toLowerCase();
  if (v === "unpaid" || v === "paid" || v === "no_invoice") return v;
  return "all";
}

export function matchesPaymentFilter(
  paymentStatus: string | undefined,
  filter: PaymentFilter,
): boolean {
  const pStatus = String(paymentStatus || "").toUpperCase();
  if (filter === "unpaid") return pStatus === "UNPAID";
  if (filter === "paid") return pStatus === "PAID";
  if (filter === "no_invoice") return !pStatus;
  return true;
}

export function includeCaseInList(opts: {
  mode: CaseListMode;
  status?: string;
  paymentStatus?: string;
  paymentFilter: PaymentFilter;
}): boolean {
  if (opts.mode === "active" && !STILL_ACTIVE.has(canonicalStatus(opts.status))) {
    return false;
  }
  return matchesPaymentFilter(opts.paymentStatus, opts.paymentFilter);
}

export function isServedCaseStatus(status?: string): boolean {
  return canonicalStatus(status) === "served";
}

export function caseStatusLabel(status?: string): string {
  const raw = String(status || "").trim();
  if (raw === "completed") return "Completed";
  if (raw === "Open") return "Open";
  if (raw === "Served") return "Served";
  const c = canonicalStatus(status);
  const labels: Record<string, string> = {
    active: "Active",
    served: "Served",
    "non-service": "Non-Service",
    "on-hold": "On Hold",
    closed: "Closed",
  };
  if (labels[c]) return labels[c];
  return raw || "Active";
}

export function caseStatusBadgeClass(status?: string): string {
  switch (canonicalStatus(status)) {
    case "served":
      return "bg-emerald-100 text-emerald-800 hover:bg-emerald-100";
    case "closed":
      return "bg-slate-100 text-slate-700 hover:bg-slate-100";
    case "non-service":
      return "bg-rose-100 text-rose-800 hover:bg-rose-100";
    case "on-hold":
      return "bg-amber-100 text-amber-800 hover:bg-amber-100";
    default:
      return "bg-blue-100 text-blue-800 hover:bg-blue-100";
  }
}

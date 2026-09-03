import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Briefcase,
  Search,
  UserCheck,
  UserX,
  RefreshCw,
  FileText,
  Send,
  ChevronRight,
  Filter,
  CheckCircle2,
  Clock,
  AlertCircle,
  Copy,
  Check,
  DollarSign
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import FieldSheetButton from "./FieldSheetButton";
import NudgeServerDialog from "./NudgeServerDialog";
import ServerAssignmentPanel from "./ServerAssignmentPanel";
import EditCaseDialog from "./EditCaseDialog";
import MarkPaidDialog from "./MarkPaidDialog";
import {
  STILL_ACTIVE,
  canonicalStatus,
  includeCaseInList,
  type CaseListMode,
  type PaymentFilter,
} from "@/lib/caseFilters";

const CASE_STATUSES = [
  { value: "active", label: "Active" },
  { value: "served", label: "Served" },
  { value: "non-service", label: "Non-Service" },
  { value: "on-hold", label: "On Hold" },
  { value: "closed", label: "Closed" },
] as const;

function statusSelectClass(status: string): string {
  switch (status) {
    case "served":
      return "h-8 w-[132px] text-[11px] font-semibold bg-emerald-50 text-emerald-800 border-emerald-300";
    case "closed":
      return "h-8 w-[132px] text-[11px] font-semibold bg-slate-100 text-slate-700 border-slate-300";
    case "non-service":
      return "h-8 w-[132px] text-[11px] font-semibold bg-rose-50 text-rose-800 border-rose-300";
    case "on-hold":
      return "h-8 w-[132px] text-[11px] font-semibold bg-amber-50 text-amber-800 border-amber-300";
    default:
      return "h-8 w-[132px] text-[11px] font-semibold bg-blue-50 text-blue-800 border-blue-300";
  }
}

export interface ActiveCaseItem {
  id: string;
  $id?: string;
  case_number: string;
  case_name?: string;
  client_id?: string;
  client_name?: string;
  defendant_respondent?: string;
  plaintiff_petitioner?: string;
  court_name?: string;
  home_address?: string;
  work_address?: string;
  documents_to_serve?: string;
  service_requirements?: string;
  contact_info?: string;
  notes?: string;
  assigned_to?: string;
  assigned_name?: string;
  quoted_fee?: string | number;
  invoice_id?: string;
  invoice_number?: string;
  pay_url?: string;
  payment_status?: string;
  paid_at?: string;
  payment_method?: string;
  payment_notes?: string;
  status: string;
  created_at: string;
  updated_at?: string;
}

export default function ActiveCasesPanel({
  fullPage = false,
  mode = "active",
  paymentFilter: controlledPaymentFilter,
  onPaymentFilterChange,
}: {
  fullPage?: boolean;
  mode?: CaseListMode;
  paymentFilter?: PaymentFilter;
  onPaymentFilterChange?: (filter: PaymentFilter) => void;
}) {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [cases, setCases] = useState<ActiveCaseItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [serverFilter, setServerFilter] = useState<string>("all");
  const [internalPaymentFilter, setInternalPaymentFilter] = useState<PaymentFilter>("all");
  const paymentFilter = controlledPaymentFilter ?? internalPaymentFilter;
  const setPaymentFilter = (filter: PaymentFilter) => {
    if (onPaymentFilterChange) onPaymentFilterChange(filter);
    else setInternalPaymentFilter(filter);
  };
  const isBilling = mode === "billing";
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [markPaidTarget, setMarkPaidTarget] = useState<ActiveCaseItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchActiveCases = async () => {
    setLoading(true);
    try {
      const raw = await api.getCases();
      if (Array.isArray(raw)) {
        const visible = isBilling
          ? raw
          : raw.filter((c: any) => STILL_ACTIVE.has(canonicalStatus(c.status)));
        setCases(visible);
      }
    } catch (err) {
      console.error("Failed to load active cases:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActiveCases();
  }, []);

  const handleStatusChange = async (caseId: string, status: string) => {
    if (!caseId) return;
    setUpdatingStatusId(caseId);
    try {
      await api.updateCaseStatus(caseId, status);
      toast({ title: "Status updated", description: `Case is now ${status.replace(/-/g, " ")}.` });
      if (isBilling || STILL_ACTIVE.has(status)) {
        setCases((prev) => prev.map((c) => (c.id === caseId || c.$id === caseId ? { ...c, status } : c)));
      } else {
        setCases((prev) => prev.filter((c) => c.id !== caseId && c.$id !== caseId));
      }
    } catch (err) {
      toast({
        title: "Could not update status",
        description: err instanceof Error ? err.message : "Request failed",
        variant: "destructive",
      });
    } finally {
      setUpdatingStatusId(null);
    }
  };

  // Filter cases by search term, server assignment, and payment status
  const filtered = cases.filter((c) => {
    const text = `${c.case_number} ${c.defendant_respondent || ""} ${c.case_name || ""} ${c.assigned_name || ""} ${c.client_name || ""}`.toLowerCase();
    const matchesSearch = !search.trim() || text.includes(search.toLowerCase());
    if (!matchesSearch) return false;

    if (serverFilter !== "all") {
      if (serverFilter === "unassigned" && c.assigned_to) return false;
      if (serverFilter !== "unassigned" && c.assigned_to !== serverFilter) return false;
    }

    if (!includeCaseInList({
      mode: isBilling ? "billing" : "active",
      status: c.status,
      paymentStatus: c.payment_status,
      paymentFilter,
    })) return false;

    return true;
  });

  const unpaidCasesCount = cases.filter((c) => String(c.payment_status || "").toUpperCase() === "UNPAID").length;
  const paidCasesCount = cases.filter((c) => String(c.payment_status || "").toUpperCase() === "PAID").length;
  const noInvoiceCount = cases.filter((c) => !c.payment_status).length;

  const copyPayLink = async (caseId: string, payUrl: string) => {
    try {
      await navigator.clipboard.writeText(payUrl);
      setCopiedId(caseId);
      setTimeout(() => setCopiedId(null), 2000);
      toast({ title: "Pay link copied", description: payUrl });
    } catch {
      toast({ title: "Failed to copy link", description: payUrl, variant: "destructive" });
    }
  };

  const handleEditCase = async (caseData: any) => {
    const caseId = caseData.id || caseData.$id;
    if (!caseId) return;
    try {
      await api.updateCase(caseId, caseData);
      toast({ title: "Case updated", description: `Case #${caseData.case_number || ""} saved.` });
      fetchActiveCases();
    } catch (err) {
      toast({
        title: "Could not update case",
        description: err instanceof Error ? err.message : "Request failed",
        variant: "destructive",
      });
    }
  };

  // Extract unique assigned servers for filter dropdown
  const assignedServers = Array.from(
    new Map(
      cases
        .filter((c) => c.assigned_to && c.assigned_name)
        .map((c) => [c.assigned_to, c.assigned_name])
    ).entries()
  );

  return (
    <Card className="border border-slate-200 dark:border-slate-800 shadow-sm mb-6">
      <CardHeader className="pb-3 border-b bg-slate-50/50 dark:bg-slate-900/50">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base font-bold flex items-center gap-2 text-slate-900 dark:text-slate-100">
              <Briefcase className="h-5 w-5 text-blue-600" />
              {isBilling
                ? `Accounts Receivable (${cases.length})`
                : `Active Cases Management (${cases.length})`}
            </CardTitle>
            <CardDescription className="text-xs text-slate-500">
              {isBilling
                ? "Money on cases — unpaid A/R, collected, and jobs with no ServeTracker invoice. Served and closed jobs stay here."
                : "Overview of all open cases, real-time server assignments, field sheets, and 1-click nudges."}
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={fetchActiveCases}
            disabled={loading}
            className="h-8 text-xs self-start sm:self-auto"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Search & Filter Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 mt-3">
          <div className="sm:col-span-8 relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search case #, person, address, or server..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
          </div>
          <div className="sm:col-span-4">
            <Select value={serverFilter} onValueChange={setServerFilter}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Filter by Server" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Servers ({cases.length})</SelectItem>
                <SelectItem value="unassigned">
                  ⚠️ Unassigned ({cases.filter((c) => !c.assigned_to).length})
                </SelectItem>
                {assignedServers.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name} ({cases.filter((c) => c.assigned_to === id).length})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Payment Status Filter Pills (Admin only) */}
        {isAdmin && (
          <div className="flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-slate-200/70 dark:border-slate-800 flex-wrap">
            <span className="text-[11px] font-semibold text-slate-500 mr-1 flex items-center gap-1">
              <DollarSign className="h-3 w-3 text-emerald-600" /> Billing:
            </span>
            <Button
              type="button"
              variant={paymentFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setPaymentFilter("all")}
              className="h-6 text-[11px] px-2.5 py-0 rounded-full font-medium"
            >
              All ({cases.length})
            </Button>
            <Button
              type="button"
              variant={paymentFilter === "unpaid" ? "default" : "outline"}
              size="sm"
              onClick={() => setPaymentFilter("unpaid")}
              className={`h-6 text-[11px] px-2.5 py-0 rounded-full font-medium ${
                paymentFilter === "unpaid" ? "bg-amber-600 hover:bg-amber-700 text-white" : "text-amber-800 border-amber-300 hover:bg-amber-50"
              }`}
            >
              ⚠️ Unpaid ({unpaidCasesCount})
            </Button>
            <Button
              type="button"
              variant={paymentFilter === "paid" ? "default" : "outline"}
              size="sm"
              onClick={() => setPaymentFilter("paid")}
              className={`h-6 text-[11px] px-2.5 py-0 rounded-full font-medium ${
                paymentFilter === "paid" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "text-emerald-800 border-emerald-300 hover:bg-emerald-50"
              }`}
            >
              🟢 Paid ({paidCasesCount})
            </Button>
            <Button
              type="button"
              variant={paymentFilter === "no_invoice" ? "default" : "outline"}
              size="sm"
              onClick={() => setPaymentFilter("no_invoice")}
              className="h-6 text-[11px] px-2.5 py-0 rounded-full font-medium text-slate-600"
            >
              No Invoice ({noInvoiceCount})
            </Button>
          </div>
        )}
      </CardHeader>

      <CardContent className="p-0">
        {loading ? (
          <div className="p-8 text-center text-slate-500">
            <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-blue-600" />
            <p className="text-xs">{isBilling ? "Loading invoices..." : "Loading active cases..."}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            <Briefcase className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm font-medium">
              {isBilling ? "No matching invoices found" : "No matching active cases found"}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {search || serverFilter !== "all" || paymentFilter !== "all"
                ? "Try adjusting your search or filter."
                : isBilling
                  ? "No invoices are linked to cases yet."
                  : (
                    <>
                      All cases are currently closed or served.{" "}
                      <Link to="/billing?filter=unpaid" className="text-amber-700 underline font-semibold">
                        Open Billing (A/R)
                      </Link>{" "}
                      for unpaid invoices on closed jobs.
                    </>
                  )}
            </p>
          </div>
        ) : (
          <div className={`divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto ${fullPage ? "" : "max-h-[520px]"}`}>
            {filtered.map((item) => {
              const caseId = item.id || item.$id || "";
              const person = item.defendant_respondent || item.case_name || "Recipient";
              const isAssigned = Boolean(item.assigned_to);

              return (
                <div
                  key={caseId}
                  className="p-3.5 hover:bg-slate-50/80 dark:hover:bg-slate-900/50 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3"
                >
                  {/* Left: Case Info & Person */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-mono text-xs font-bold text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">
                        #{item.case_number}
                      </span>
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                        {person}
                      </span>
                      {isAdmin && item.payment_status === "UNPAID" && (
                        <Badge className="bg-amber-400 text-amber-950 hover:bg-amber-400 text-[10px] py-0 px-1.5 font-bold">
                          UNPAID {item.quoted_fee ? `($${Number(item.quoted_fee).toFixed(0)})` : ""}
                        </Badge>
                      )}
                      {isAdmin && item.payment_status === "PAID" && (
                        <Badge className="bg-emerald-600 text-white hover:bg-emerald-600 text-[10px] py-0 px-1.5 font-bold">
                          PAID {item.payment_method ? `(${item.payment_method})` : ""}
                        </Badge>
                      )}
                      {item.client_name && (
                        <span className="text-[11px] text-slate-500">
                          · Client: <strong>{item.client_name}</strong>
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-slate-600 dark:text-slate-400 flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                      {item.home_address && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.home_address)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate max-w-[280px] text-blue-600 hover:text-blue-800 underline flex items-center gap-1 font-medium"
                          onClick={(e) => e.stopPropagation()}
                        >
                          📍 {item.home_address}
                        </a>
                      )}
                      {item.work_address && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.work_address)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate max-w-[240px] text-blue-600 hover:text-blue-800 underline flex items-center gap-1 font-medium"
                          onClick={(e) => e.stopPropagation()}
                        >
                          🏢 {item.work_address}
                        </a>
                      )}
                      {item.documents_to_serve && (
                        <span className="text-slate-500 truncate max-w-[240px]">
                          📄 {item.documents_to_serve}
                        </span>
                      )}
                    </div>

                    {/* Assignment + quick status */}
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      {isAssigned ? (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-800 border-emerald-300 text-[11px] font-semibold flex items-center gap-1">
                          <UserCheck className="h-3 w-3 text-emerald-600" />
                          Assigned: {item.assigned_name}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-300 text-[11px] font-semibold flex items-center gap-1">
                          <UserX className="h-3 w-3 text-amber-600" />
                          Unassigned
                        </Badge>
                      )}
                      <Select
                        value={canonicalStatus(item.status)}
                        onValueChange={(value) => void handleStatusChange(caseId, value)}
                        disabled={updatingStatusId === caseId}
                      >
                        <SelectTrigger className={statusSelectClass(canonicalStatus(item.status))} aria-label="Case status">
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                          {CASE_STATUSES.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value} className="text-xs">
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Right: Action Buttons */}
                  <div className="flex items-center gap-2 shrink-0 flex-wrap self-end md:self-auto">
                    {/* Admin Payment Action Buttons */}
                    {isAdmin && (
                      <div className="flex items-center gap-1.5">
                        {item.pay_url && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => copyPayLink(caseId, item.pay_url!)}
                            className="h-8 text-xs px-2 border-blue-200 text-blue-700 hover:bg-blue-50"
                            title="Copy online payment link"
                          >
                            {copiedId === caseId ? <Check className="h-3.5 w-3.5 text-emerald-600 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                            {copiedId === caseId ? "Copied" : "Pay Link"}
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setMarkPaidTarget(item)}
                          className={`h-8 text-xs px-2 font-semibold ${
                            item.payment_status === "PAID"
                              ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                              : "border-amber-300 text-amber-800 hover:bg-amber-50"
                          }`}
                          title="Record payment (Check / Cash / Override)"
                        >
                          <DollarSign className="h-3.5 w-3.5 mr-0.5" />
                          {item.payment_status === "PAID" ? "Payment Info" : "Record Pay"}
                        </Button>
                      </div>
                    )}

                    {/* Quick Edit (admin only) */}
                    {isAdmin && (
                      <EditCaseDialog
                        clientCase={{
                          $id: caseId,
                          client_id: item.client_id || "",
                          case_number: item.case_number,
                          case_name: item.case_name || "",
                          court_name: item.court_name,
                          plaintiff_petitioner: item.plaintiff_petitioner,
                          defendant_respondent: item.defendant_respondent,
                          notes: item.notes,
                          status: item.status,
                          created_at: item.created_at,
                          updated_at: item.updated_at || "",
                          home_address: item.home_address,
                          work_address: item.work_address,
                          documents_to_serve: item.documents_to_serve,
                          assigned_to: item.assigned_to,
                          assigned_name: item.assigned_name,
                          service_requirements: item.service_requirements,
                          contact_info: item.contact_info,
                        }}
                        onUpdate={handleEditCase}
                        className="h-8 text-xs"
                      />
                    )}

                    {/* 1-Click Field Sheet Modal & Print */}
                    <FieldSheetButton
                      className="h-8 text-xs"
                      data={{
                        caseId,
                        caseNumber: item.case_number,
                        caseName: item.case_name,
                        courtName: item.court_name,
                        plaintiff: item.plaintiff_petitioner,
                        defendant: item.defendant_respondent,
                        documents: item.documents_to_serve || "",
                        notes: item.notes,
                        requirements: item.service_requirements || "",
                        contactInfo: item.contact_info || "",
                        homeAddress: item.home_address,
                        workAddress: item.work_address,
                        personToServe: person,
                        assignedServer: item.assigned_name,
                        clientName: item.client_name,
                      }}
                    />

                    {/* Server Assignment Panel Trigger */}
                    <ServerAssignmentPanel
                      caseId={caseId}
                      currentServerId={item.assigned_to}
                      currentServerName={item.assigned_name}
                      onAssigned={fetchActiveCases}
                    />

                    {/* 1-Click Nudge (Only if assigned) */}
                    {isAssigned && (
                      <NudgeServerDialog
                        caseId={caseId}
                        caseNumber={item.case_number}
                        serverName={item.assigned_name}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <MarkPaidDialog
        open={Boolean(markPaidTarget)}
        onOpenChange={(open) => !open && setMarkPaidTarget(null)}
        caseItem={markPaidTarget}
        onSuccess={fetchActiveCases}
      />
    </Card>
  );
}

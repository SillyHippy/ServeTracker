import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { ServerWorkloadPayload, WorkloadServer, AssignmentEvent } from "@/types/ServerProfile";
import SignatureStatusBadge from "@/components/SignatureStatusBadge";
import ServerIntakeDialog from "@/components/ServerIntakeDialog";
import ServerProfileDialog from "@/components/ServerProfileDialog";
import ServerAssignmentPanel from "@/components/ServerAssignmentPanel";
import {
  Briefcase, UserPlus, RefreshCw, Loader2, ChevronDown, ChevronRight, Inbox, Search,
} from "lucide-react";

interface CaseRow {
  id: string;
  case_number: string;
  case_name: string;
  defendant_respondent: string;
  status: string;
  assigned_at: string;
  updated_at: string;
  assigned_to?: string;
  assigned_name?: string;
  home_address?: string;
}

export default function Servers() {
  const [params, setParams] = useSearchParams();
  const { user: authUser } = useAuth();
  const [data, setData] = useState<ServerWorkloadPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isIntakeOpen, setIsIntakeOpen] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [selectedServer, setSelectedServer] = useState<string | null>(params.get("server"));
  const [caseDetail, setCaseDetail] = useState<{ cases: CaseRow[]; events: AssignmentEvent[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [activeCases, setActiveCases] = useState<CaseRow[]>([]);
  const [caseSearch, setCaseSearch] = useState("");
  const { toast } = useToast();

  const filter = params.get("filter") || "";
  const caseView = filter === "unassigned" ? "unassigned" : (filter === "assigned" ? "assigned" : "all");

  const load = async () => {
    try {
      setIsLoading(true);
      const res = await api.getServerWorkload();
      if (!res || !Array.isArray(res.servers)) {
        throw new Error("Server workload response was empty");
      }
      setData(res);
      try {
        const all = await api.getCases();
        const rows = (Array.isArray(all) ? all : []).map((c: any) => ({
          id: String(c.id || c.$id || ""),
          case_number: c.case_number || c.caseNumber || "",
          case_name: c.case_name || c.caseName || "",
          defendant_respondent: c.defendant_respondent || c.defendantRespondent || c.case_name || "",
          status: c.status || "Open",
          assigned_at: c.assigned_at || c.created_at || "",
          updated_at: c.updated_at || "",
          assigned_to: c.assigned_to || "",
          assigned_name: c.assigned_name || "",
          home_address: c.home_address || c.homeAddress || "",
        })).filter((c) => {
          const st = (c.status || "").toLowerCase();
          return st !== "closed" && st !== "completed";
        });
        rows.sort((a, b) => Number(!!b.assigned_to) - Number(!!a.assigned_to) === 0
          ? String(b.updated_at).localeCompare(String(a.updated_at))
          : (a.assigned_to ? 1 : -1));
        setActiveCases(rows);
      } catch {
        setActiveCases([]);
      }
      // If the URL pointed at a server id, auto-open its detail
      const sid = params.get("server");
      if (sid && res.servers.some((s) => s.id === sid)) {
        setSelectedServer(sid);
        await loadDetail(sid);
      }
    } catch (err) {
      toast({ title: "Load failed", description: err instanceof Error ? err.message : "Could not load servers", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const loadDetail = async (serverId: string) => {
    setDetailLoading(true);
    try {
      const res = await api.getServerCases(serverId);
      const rawCases = Array.isArray(res.cases) ? res.cases : [];
      setCaseDetail({
        cases: rawCases.map((c: any) => ({
          id: c.id || c.$id,
          case_number: c.case_number || c.caseNumber || "",
          case_name: c.case_name || c.caseName || "",
          defendant_respondent: c.defendant_respondent || c.defendantRespondent || c.case_name || "",
          status: c.status || "Open",
          assigned_at: c.assigned_at || c.created_at || "",
          updated_at: c.updated_at || "",
        })),
        events: res.assignment_history || [],
      });
    } catch (err) {
      toast({ title: "Detail load failed", description: err instanceof Error ? err.message : "Could not load cases", variant: "destructive" });
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [params]);

  const toggleDetail = async (serverId: string) => {
    if (selectedServer === serverId) {
      setSelectedServer(null);
      setCaseDetail(null);
      return;
    }
    setSelectedServer(serverId);
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("server", serverId);
      return next;
    }, { replace: true });
    await loadDetail(serverId);
  };

  const filtered = (data?.servers || []).filter((s) => {
    if (filterText && !`${s.displayName} ${s.username} ${s.legalName}`.toLowerCase().includes(filterText.toLowerCase())) return false;
    return true;
  });

  const serverOptions = (data?.servers || [])
    .filter((s) => s.role === "server")
    .map((s) => {
      let ineligible: string | undefined;
      if (!s.isActive) ineligible = "inactive";
      else if (s.onboardingStatus !== "active") ineligible = s.onboardingStatus;
          else if (s.licenseStatus === "expired") ineligible = "license expired";
          return { id: s.id, label: `${s.displayName} (@${s.username})`, ineligible };
    });

  const visibleCases = activeCases.filter((c) => {
    if (caseView === "unassigned" && c.assigned_to) return false;
    if (caseView === "assigned" && !c.assigned_to) return false;
    if (caseSearch) {
      const hay = `${c.case_number} ${c.case_name} ${c.defendant_respondent} ${c.assigned_name}`.toLowerCase();
      if (!hay.includes(caseSearch.toLowerCase())) return false;
    }
    return true;
  });

  const setCaseView = (next: string) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      if (next === "all") p.delete("filter");
      else p.set("filter", next);
      return p;
    }, { replace: true });
  };

  return (
    <div className="w-full pb-16 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Field Servers</h1>
          <p className="text-slate-500 text-xs sm:text-sm">
            Onboard, assign work, review credentials, sessions, and signatures
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button size="sm" onClick={() => setIsIntakeOpen(true)}>
            <UserPlus className="h-4 w-4 mr-1" /> Add Field Server
          </Button>
        </div>
      </div>

      {/* Active cases assignment board */}
      <Card className="border-slate-200">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Active cases</CardTitle>
              <CardDescription className="text-xs">
                Assign or reassign open jobs without opening a client record. Expired or inactive accounts cannot receive jobs. Missing license is allowed; 1-click affidavit signing still needs a license on file.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant={caseView === "all" ? "default" : "outline"} onClick={() => setCaseView("all")}>
                All ({activeCases.length})
              </Button>
              <Button size="sm" variant={caseView === "unassigned" ? "default" : "outline"} onClick={() => setCaseView("unassigned")}>
                Unassigned ({activeCases.filter((c) => !c.assigned_to).length})
              </Button>
              <Button size="sm" variant={caseView === "assigned" ? "default" : "outline"} onClick={() => setCaseView("assigned")}>
                Assigned ({activeCases.filter((c) => !!c.assigned_to).length})
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search case #, person, or server…"
              value={caseSearch}
              onChange={(e) => setCaseSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {visibleCases.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No active cases match this filter.</p>
          ) : (
            <div className="divide-y rounded-md border border-slate-100">
              {visibleCases.map((c) => (
                <div key={c.id} className="p-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">
                      {c.defendant_respondent || c.case_name || "Target"}{" "}
                      <span className="font-mono text-blue-700 text-xs">#{c.case_number || "no #"}</span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {c.status}
                      {c.home_address ? ` · ${c.home_address}` : ""}
                      {c.assigned_name ? ` · currently ${c.assigned_name}` : " · unassigned"}
                    </div>
                  </div>
                  <ServerAssignmentPanel
                    caseId={c.id}
                    currentAssignedId={c.assigned_to || ""}
                    currentAssignedName={c.assigned_name || ""}
                    servers={serverOptions}
                    onChanged={load}
                    compact
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Unassigned active cases */}
      {data && data.unassignedActiveCases > 0 && (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="pt-4 pb-4 flex items-center gap-3 text-sm">
            <Inbox className="h-5 w-5 text-amber-600 shrink-0" />
            <span className="font-semibold text-amber-900">
              {data.unassignedActiveCases} active case{data.unassignedActiveCases === 1 ? "" : "s"} with no field server assigned
            </span>
            <span className="text-xs text-amber-800 ml-auto">
              Assign them from Clients → Edit Case, or the dashboard workload card.
            </span>
          </CardContent>
        </Card>
      )}

      {/* Search + filter */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search servers…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {isLoading ? (
        <Card className="p-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading servers…
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          <Briefcase className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          No field servers found. Click "Add Field Server" to create one.
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((s: WorkloadServer) => (
            <Card key={s.id} className="border-slate-200 shadow-xs">
              <button
                type="button"
                className="w-full text-left p-4 flex items-center justify-between gap-3 hover:bg-slate-50/70 transition"
                onClick={() => toggleDetail(s.id)}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-bold text-slate-900">{s.displayName}</span>
                    <Badge variant="secondary" className="text-[10px] uppercase">{s.username}</Badge>
                    {!s.isActive && <Badge variant="destructive" className="text-[10px]">Inactive</Badge>}
                    {s.onboardingStatus !== "active" && (
                      <Badge variant="secondary" className="text-[10px]">{s.onboardingStatus}</Badge>
                    )}
                    {s.licenseStatus === "expired" && <Badge variant="destructive" className="text-[10px]">License expired</Badge>}
                    {s.licenseStatus === "expires_soon" && <Badge variant="secondary" className="text-[10px]">License expiring</Badge>}
                    {s.licenseStatus === "missing" && <Badge variant="outline" className="text-[10px]">No license</Badge>}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    <span className="font-semibold">{s.assignedActiveCases}</span> active cases ·{" "}
                    <span className={s.noAttemptCases > 0 ? "text-amber-700 font-semibold" : ""}>{s.noAttemptCases}</span> no attempt ·{" "}
                    <span className={s.stale48hCases > 0 ? "text-red-600 font-semibold" : ""}>{s.stale48hCases}</span> stale 48h ·{" "}
                    {s.activityToday} today / {s.activity7Days} 7d
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Last activity: {s.lastActivity ? new Date(s.lastActivity).toLocaleString() : "never"}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <SignatureStatusBadge status={s.signatureStatus} />
                  {selectedServer === s.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </div>
              </button>

              {selectedServer === s.id && (
                <div className="border-t border-slate-100 p-4 space-y-4">
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setProfileUserId(s.id)}>
                      Open profile & manage
                    </Button>
                  </div>

                  {detailLoading ? (
                    <div className="text-xs text-slate-500 flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading cases…
                    </div>
                  ) : (
                    <>
                      {caseDetail && caseDetail.cases.length > 0 ? (
                        <div className="divide-y rounded-md border border-slate-100">
                          {caseDetail.cases.map((c) => (
                            <div key={c.id} className="p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-slate-900">
                                  {c.defendant_respondent || c.case_name || "Target"} · <span className="font-mono text-blue-700 text-xs">{c.case_number}</span>
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  Status: {c.status} · Updated {c.updated_at ? new Date(c.updated_at).toLocaleString() : "—"}
                                </div>
                              </div>
                              <ServerAssignmentPanel
                                caseId={c.id}
                                currentAssignedId={s.id}
                                currentAssignedName={s.displayName}
                                servers={serverOptions}
                                onChanged={() => { load(); loadDetail(s.id); }}
                                compact
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-slate-500 py-2">No cases assigned to this server.</div>
                      )}

                      {caseDetail && caseDetail.events.length > 0 && (
                        <div>
                          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Assignment history</h4>
                          <div className="max-h-40 overflow-y-auto rounded-md border border-slate-100 divide-y">
                            {caseDetail.events.map((ev) => (
                              <div key={ev.id} className="p-2 text-[11px] text-slate-600 flex justify-between gap-2">
                                <span>
                                  Case {ev.case_id.slice(0, 8)}: {ev.previous_server_id ? "reassigned" : "assigned"}
                                  {ev.note ? ` (${ev.note})` : ""}
                                </span>
                                <span className="text-slate-400">{new Date(ev.occurred_at).toLocaleString()}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <ServerIntakeDialog open={isIntakeOpen} onOpenChange={setIsIntakeOpen} onCreated={load} />
      {profileUserId && (
        <ServerProfileDialog
          userId={profileUserId}
          open={!!profileUserId}
          onOpenChange={(o) => { if (!o) setProfileUserId(null); }}
          onChanged={load}
          isSelf={profileUserId === authUser?.id}
        />
      )}
    </div>
  );
}

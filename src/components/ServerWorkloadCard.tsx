import React, { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { ServerWorkloadPayload, WorkloadServer } from "@/types/ServerProfile";
import SignatureStatusBadge from "@/components/SignatureStatusBadge";
import { Briefcase, Clock, AlertTriangle, RefreshCw, ChevronRight, Inbox } from "lucide-react";

export const ServerWorkloadCard: React.FC = () => {
  const [data, setData] = useState<ServerWorkloadPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const load = async () => {
    try {
      setIsLoading(true);
      const res = await api.getServerWorkload();
      setData(res);
    } catch (err) {
      toast({ title: "Workload load failed", description: err instanceof Error ? err.message : "Could not load workload", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const licenseBadge = (s: WorkloadServer) => {
    switch (s.licenseStatus) {
      case "expired": return <Badge variant="destructive" className="text-[10px]">License expired</Badge>;
      case "expires_soon": return <Badge variant="secondary" className="text-[10px]">License expiring</Badge>;
      case "missing": return <Badge variant="outline" className="text-[10px]">No license</Badge>;
      default: return null;
    }
  };

  return (
    <Card className="border border-slate-200 dark:border-slate-800 shadow-xs">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-blue-600" /> Field Server Workload
            </CardTitle>
            <CardDescription className="text-xs">
              Assigned jobs, aging, activity, and readiness at a glance
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={load} disabled={isLoading} className="h-8 w-8 p-0">
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Unassigned active cases banner */}
        <Link to="/servers?filter=unassigned" className="block">
          <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm hover:bg-amber-100/70 transition">
            <span className="flex items-center gap-2 font-semibold text-amber-900">
              <Inbox className="h-4 w-4 text-amber-600" />
              Unassigned active cases
            </span>
            <span className="flex items-center gap-1 font-bold text-amber-900">
              {isLoading ? "…" : data?.unassignedActiveCases ?? 0}
              <ChevronRight className="h-4 w-4" />
            </span>
          </div>
        </Link>

        {isLoading ? (
          <div className="py-6 text-center text-xs text-muted-foreground">Loading workload…</div>
        ) : !data || data.servers.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            No field servers yet. Add one under Settings → Field Servers or the Servers page.
          </div>
        ) : (
          <div className="divide-y rounded-md border border-slate-100">
            {data.servers.map((s) => (
              <Link to={`/servers?server=${s.id}`} key={s.id} className="block p-3 hover:bg-slate-50/80 transition">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-900 truncate">{s.displayName}</span>
                      {!s.isActive && <Badge variant="destructive" className="text-[10px]">Inactive</Badge>}
                      {s.onboardingStatus !== "active" && (
                        <Badge variant="secondary" className="text-[10px]">{s.onboardingStatus}</Badge>
                      )}
                      {licenseBadge(s)}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {s.assignedActiveCases} active · {s.noAttemptCases} no attempt yet ·{" "}
                      {s.stale48hCases > 0 && <span className="text-amber-700 font-semibold">{s.stale48hCases} stale 48h · </span>}
                      {s.activityToday} today · {s.activity7Days} 7d
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <SignatureStatusBadge status={s.signatureStatus} />
                    <span className="flex items-center gap-1 text-[11px] text-slate-400">
                      <Clock className="h-3 w-3" />
                      {s.lastActivity ? new Date(s.lastActivity).toLocaleDateString() : "never"}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ServerWorkloadCard;

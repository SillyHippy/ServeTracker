import React, { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { AffidavitExecution } from "@/types/AffidavitExecution";
import { History, Loader2, CheckCircle2, XCircle } from "lucide-react";

interface Props {
  caseId: string;
}

const REASON_LABELS: Record<string, string> = {
  material_change: "Voided — case facts changed",
  server_changed: "Voided — assigned server changed",
  unassigned: "Voided — case unassigned",
  server_credential_changed: "Voided — server credentials changed",
  server_deactivated: "Voided — server deactivated",
};

/** Read-only history of signed affidavit versions for a case. */
export const AffidavitExecutionAudit: React.FC<Props> = ({ caseId }) => {
  const [executions, setExecutions] = useState<AffidavitExecution[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const load = async () => {
    try {
      setIsLoading(true);
      const res = await api.auditAffidavit(caseId);
      setExecutions(res.executions || []);
    } catch (err) {
      toast({ title: "Audit load failed", description: err instanceof Error ? err.message : "Could not load execution history", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [caseId]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1">
          <History className="h-3.5 w-3.5" /> Signed versions & audit
        </h4>
        <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={load} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh"}
        </Button>
      </div>

      {isLoading ? (
        <div className="text-xs text-slate-500 py-2">Loading…</div>
      ) : executions.length === 0 ? (
        <div className="text-xs text-slate-500 py-2">No signed versions yet.</div>
      ) : (
        <div className="divide-y rounded-md border border-slate-100">
          {executions.map((e) => (
            <div key={e.id} className="p-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                {e.status === "signed_not_notarized" ? (
                  <Badge variant="default" className="text-[10px] bg-green-600 hover:bg-green-600 gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Signed — notarization pending
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="text-[10px] gap-1">
                    <XCircle className="h-3 w-3" /> {REASON_LABELS[e.invalidationReason] || `Voided — ${e.invalidationReason || "unknown"}`}
                  </Badge>
                )}
                <span className="text-slate-400 font-mono text-[10px]">{e.id.slice(0, 10)}</span>
                <span className="text-slate-500">{new Date(e.createdAt).toLocaleString()}</span>
              </div>
              <div className="text-slate-500 mt-1">
                Signed by <strong>{e.signedByName || e.signedByUserId}</strong>
                {e.applicationMode === "admin_on_behalf" ? " (applied by administrator on behalf of server)" : " (server self)"} ·{" "}
                actor {e.appliedByName || e.appliedByUserId}
              </div>
              <div className="text-slate-400 font-mono text-[10px] break-all">
                source {e.sourceHash.slice(0, 16)}… · render {e.renderedHash.slice(0, 16)}…
                {e.supersedesExecutionId ? ` · supersedes ${e.supersedesExecutionId.slice(0, 10)}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AffidavitExecutionAudit;

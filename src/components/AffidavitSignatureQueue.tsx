import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PenLine, CheckCircle2, Clock, FileText, ChevronRight, UserCheck, ShieldCheck } from "lucide-react";
import { AffidavitSignatureDialog } from "@/components/AffidavitSignatureDialog";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { API_BASE } from "@/lib/api";
import { Link } from "react-router-dom";

interface ReadyAffidavitItem {
  caseId: string;
  caseNumber: string;
  caseName: string;
  defendantName: string;
  personServed: string;
  serviceMethod: string;
  servedAt: string;
  assignedServerName: string;
  status: string;
  clientName?: string;
  executionStatus?: "pending" | "signed" | "none";
}

export const AffidavitSignatureQueue: React.FC = () => {
  const { user, isAdmin, isServer } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<ReadyAffidavitItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCase, setSelectedCase] = useState<ReadyAffidavitItem | null>(null);

  const fetchQueue = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/affidavits/queue`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setItems(data.queue || []);
        return;
      }
      // Fallback
      const casesRes = await fetch(`${API_BASE}/api/cases`, { credentials: "include" });
      if (!casesRes.ok) return;
      const cases = await casesRes.json();

      const readyCases: ReadyAffidavitItem[] = [];
      for (const c of cases) {
        const isCompleted =
          c.status?.toLowerCase() === "served" ||
          c.status?.toLowerCase() === "completed";

        if (isCompleted && c.assigned_to) {
          readyCases.push({
            caseId: c.id,
            caseNumber: c.case_number,
            caseName: c.case_name || c.defendant_respondent || "",
            defendantName: c.defendant_respondent || "",
            personServed: c.defendant_respondent || c.case_name || "Recipient",
            serviceMethod: c.service_method || "Not Recorded",
            servedAt: c.updated_at || c.created_at,
            assignedServerName: c.assigned_name || (c as any).assignedServerName || "Assigned Server",
            status: c.status,
            clientName: c.client_name,
            executionStatus: c.execution_status || "none",
          });
        }
      }

      setItems(readyCases);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchQueue();
  }, []);

  if (loading || items.length === 0) {
    return null; // Silent if no affidavits awaiting signature
  }

  return (
    <Card className="border-amber-200 dark:border-amber-900 bg-amber-50/40 dark:bg-amber-950/20 shadow-xs">
      <CardHeader className="py-3 px-4 border-b border-amber-200/60 dark:border-amber-900/60 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <PenLine className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          <CardTitle className="text-sm font-bold text-amber-900 dark:text-amber-200">
            Affidavits Awaiting Signature ({items.length})
          </CardTitle>
        </div>
        <Badge variant="outline" className="bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 border-amber-300 text-[10px] font-semibold">
          Service Complete • Ready to E-Sign
        </Badge>
      </CardHeader>

      <CardContent className="p-3 space-y-2.5">
        {items.map((item) => (
          <div
            key={item.caseId}
            className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-amber-200/70 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs hover:border-amber-300 transition"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="font-mono text-xs font-bold text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">
                  #{item.caseNumber}
                </span>
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                  {item.personServed}
                </span>
                {item.clientName && (
                  <span className="text-[11px] text-muted-foreground">
                    · Client: <strong>{item.clientName}</strong>
                  </span>
                )}
              </div>

              <div className="text-[11px] text-slate-600 dark:text-slate-400 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {item.serviceMethod}
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <UserCheck className="h-3.5 w-3.5 text-slate-400" /> Server: {item.assignedServerName}
                </span>
                <span>•</span>
                <span className="flex items-center gap-1 text-slate-500">
                  <Clock className="h-3 w-3" /> {new Date(item.servedAt).toLocaleDateString()}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
              <Button
                size="sm"
                className="h-8 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-xs flex items-center gap-1.5"
                onClick={() => setSelectedCase(item)}
              >
                <PenLine className="h-3.5 w-3.5" /> Sign Affidavit
              </Button>
            </div>
          </div>
        ))}
      </CardContent>

      {selectedCase && (
        <AffidavitSignatureDialog
          caseId={selectedCase.caseId}
          caseNumber={selectedCase.caseNumber}
          personBeingServed={selectedCase.personServed}
          open={Boolean(selectedCase)}
          onOpenChange={(open) => {
            if (!open) setSelectedCase(null);
          }}
          onSigned={() => {
            toast({
              title: "Affidavit Signed ✍️",
              description: `Affidavit for ${selectedCase.personServed} is signed and finalized.`,
            });
            setSelectedCase(null);
            void fetchQueue();
          }}
        />
      )}
    </Card>
  );
};

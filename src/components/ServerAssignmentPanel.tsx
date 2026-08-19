import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { UserPlus, UserMinus, Loader2 } from "lucide-react";

interface ServerOption {
  id: string;
  label: string;
  /** eligibility note surfaced in the dropdown label when not assignable */
  ineligible?: string;
}

interface Props {
  caseId: string;
  currentAssignedId: string;
  currentAssignedName: string;
  servers: ServerOption[];
  onChanged: () => void;
  compact?: boolean;
}

export const ServerAssignmentPanel: React.FC<Props> = ({
  caseId,
  currentAssignedId,
  currentAssignedName,
  servers,
  onChanged,
  compact,
}) => {
  const [selected, setSelected] = useState<string>("");
  const [isBusy, setIsBusy] = useState(false);
  const { toast } = useToast();

  const doAssign = async () => {
    if (!selected) return;
    setIsBusy(true);
    try {
      await api.assignCase(caseId, selected);
      toast({ title: "Case assigned", description: "The case was assigned and the change was recorded." });
      setSelected("");
      onChanged();
    } catch (err) {
      toast({ title: "Assignment failed", description: err instanceof Error ? err.message : "Could not assign", variant: "destructive" });
    } finally {
      setIsBusy(false);
    }
  };

  const doUnassign = async () => {
    if (!currentAssignedId) return;
    if (!confirm("Unassign this case? The field server will lose access immediately.")) return;
    setIsBusy(true);
    try {
      await api.unassignCase(caseId);
      toast({ title: "Case unassigned", description: "The case is now unassigned." });
      onChanged();
    } catch (err) {
      toast({ title: "Unassign failed", description: err instanceof Error ? err.message : "Could not unassign", variant: "destructive" });
    } finally {
      setIsBusy(false);
    }
  };

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {currentAssignedId ? (
          <>
            <span className="text-slate-600">Assigned: <strong>{currentAssignedName || currentAssignedId}</strong></span>
            <Button variant="outline" size="sm" className="h-7" onClick={doUnassign} disabled={isBusy}>
              <UserMinus className="h-3.5 w-3.5 mr-1" /> Unassign
            </Button>
          </>
        ) : (
          <span className="text-amber-600 font-semibold">Unassigned</span>
        )}
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger className="h-7 w-48 text-xs">
            <SelectValue placeholder={currentAssignedId ? "Reassign to…" : "Assign to…"} />
          </SelectTrigger>
          <SelectContent>
            {servers.map((s) => (
              <SelectItem key={s.id} value={s.id} disabled={!!s.ineligible}>
                {s.label}{s.ineligible ? ` (${s.ineligible})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" className="h-7" onClick={doAssign} disabled={!selected || isBusy}>
          {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5 mr-1" />} Assign
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-semibold">Assigned server:</span>
        {currentAssignedId ? (
          <span className="text-slate-700">{currentAssignedName || currentAssignedId}</span>
        ) : (
          <span className="text-amber-600 font-semibold">Unassigned</span>
        )}
        {currentAssignedId && (
          <Button variant="outline" size="sm" onClick={doUnassign} disabled={isBusy}>
            <UserMinus className="h-3.5 w-3.5 mr-1" /> Unassign
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger className="w-72">
            <SelectValue placeholder={currentAssignedId ? "Reassign to another server…" : "Assign to a server…"} />
          </SelectTrigger>
          <SelectContent>
            {servers.map((s) => (
              <SelectItem key={s.id} value={s.id} disabled={!!s.ineligible}>
                {s.label}{s.ineligible ? ` (${s.ineligible})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={doAssign} disabled={!selected || isBusy}>
          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4 mr-1" />} Assign
        </Button>
      </div>
    </div>
  );
};

export default ServerAssignmentPanel;

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { UserPlus, UserMinus, Loader2 } from "lucide-react";

export interface ServerOption {
  id: string;
  label: string;
  ineligible?: string;
}

interface Props {
  caseId: string;
  currentAssignedId?: string;
  currentServerId?: string;
  currentAssignedName?: string;
  currentServerName?: string;
  servers?: ServerOption[];
  onChanged?: () => void;
  onAssigned?: () => void;
  compact?: boolean;
}

export const ServerAssignmentPanel: React.FC<Props> = ({
  caseId,
  currentAssignedId,
  currentServerId,
  currentAssignedName,
  currentServerName,
  servers: propServers,
  onChanged,
  onAssigned,
  compact,
}) => {
  const [selected, setSelected] = useState<string>("");
  const [isBusy, setIsBusy] = useState(false);
  const [loadedServers, setLoadedServers] = useState<ServerOption[]>([]);
  const { toast } = useToast();

  const assignedId = currentAssignedId || currentServerId || "";
  const assignedName = currentAssignedName || currentServerName || "";
  const triggerChange = () => {
    if (onChanged) onChanged();
    if (onAssigned) onAssigned();
  };

  // If servers array was not supplied by caller, fetch active servers from API
  useEffect(() => {
    if (propServers && Array.isArray(propServers) && propServers.length > 0) {
      setLoadedServers(propServers);
      return;
    }

    let active = true;
    api.getUsers()
      .then((users: any) => {
        if (!active || !Array.isArray(users)) return;
        const opts: ServerOption[] = users
          .filter((u) => u.role === "server" && u.is_active !== 0)
          .map((u) => ({
            id: u.id,
            label: u.legal_name || u.display_name || u.username,
            ineligible:
              u.onboarding_status !== "active"
                ? "Pending onboarding"
                : u.license_expires_at && new Date(u.license_expires_at).getTime() < Date.now()
                ? "License expired"
                : undefined,
          }));
        setLoadedServers(opts);
      })
      .catch(() => {
        // ignore
      });

    return () => {
      active = false;
    };
  }, [propServers]);

  const availableServers = propServers && propServers.length > 0 ? propServers : loadedServers;

  const doAssign = async () => {
    if (!selected) return;
    setIsBusy(true);
    try {
      await api.assignCase(caseId, selected);
      toast({ title: "Case assigned", description: "The case was assigned and the change was recorded." });
      setSelected("");
      triggerChange();
    } catch (err) {
      toast({ title: "Assignment failed", description: err instanceof Error ? err.message : "Could not assign", variant: "destructive" });
    } finally {
      setIsBusy(false);
    }
  };

  const doUnassign = async () => {
    if (!assignedId) return;
    if (!confirm("Unassign this case? The field server will lose access immediately.")) return;
    setIsBusy(true);
    try {
      await api.unassignCase(caseId);
      toast({ title: "Case unassigned", description: "The case is now unassigned." });
      triggerChange();
    } catch (err) {
      toast({ title: "Unassign failed", description: err instanceof Error ? err.message : "Could not unassign", variant: "destructive" });
    } finally {
      setIsBusy(false);
    }
  };

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {assignedId ? (
          <>
            <span className="text-slate-600">Assigned: <strong>{assignedName || assignedId}</strong></span>
            <Button variant="outline" size="sm" className="h-7" onClick={doUnassign} disabled={isBusy}>
              <UserMinus className="h-3.5 w-3.5 mr-1" /> Unassign
            </Button>
          </>
        ) : (
          <span className="text-amber-600 font-semibold">Unassigned</span>
        )}
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger className="h-7 w-44 text-xs">
            <SelectValue placeholder={assignedId ? "Reassign to…" : "Assign to…"} />
          </SelectTrigger>
          <SelectContent>
            {availableServers.map((s) => (
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
    <div className="flex items-center gap-1.5">
      <Select value={selected} onValueChange={setSelected}>
        <SelectTrigger className="h-8 w-36 sm:w-44 text-xs">
          <SelectValue placeholder={assignedId ? "Reassign…" : "Assign Server…"} />
        </SelectTrigger>
        <SelectContent>
          {availableServers.map((s) => (
            <SelectItem key={s.id} value={s.id} disabled={!!s.ineligible}>
              {s.label}{s.ineligible ? ` (${s.ineligible})` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected ? (
        <Button size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white" onClick={doAssign} disabled={isBusy}>
          {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
        </Button>
      ) : assignedId ? (
        <Button variant="ghost" size="sm" className="h-8 text-xs text-slate-500 hover:text-red-600" onClick={doUnassign} disabled={isBusy}>
          Unassign
        </Button>
      ) : null}
    </div>
  );
};

export default ServerAssignmentPanel;

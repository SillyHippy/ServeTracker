import React, { useState, useEffect } from "react";
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
  AlertCircle
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
import FieldSheetButton from "./FieldSheetButton";
import NudgeServerDialog from "./NudgeServerDialog";
import ServerAssignmentPanel from "./ServerAssignmentPanel";

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
  status: string;
  created_at: string;
  updated_at?: string;
}

export default function ActiveCasesPanel() {
  const [cases, setCases] = useState<ActiveCaseItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [serverFilter, setServerFilter] = useState<string>("all");
  const [selectedCaseForAssign, setSelectedCaseForAssign] = useState<ActiveCaseItem | null>(null);

  const fetchActiveCases = async () => {
    setLoading(true);
    try {
      const raw = await api.getCases();
      if (Array.isArray(raw)) {
        // Filter to active/open cases only
        const active = raw.filter(
          (c: any) =>
            !c.status ||
            c.status.toLowerCase() === "open" ||
            c.status.toLowerCase() === "active" ||
            c.status.toLowerCase() === "in_progress" ||
            c.status.toLowerCase() === "pending"
        );
        setCases(active);
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

  // Filter cases by search term and server assignment
  const filtered = cases.filter((c) => {
    const text = `${c.case_number} ${c.defendant_respondent || ""} ${c.case_name || ""} ${c.assigned_name || ""} ${c.client_name || ""}`.toLowerCase();
    const matchesSearch = !search.trim() || text.includes(search.toLowerCase());
    
    if (!matchesSearch) return false;
    if (serverFilter === "all") return true;
    if (serverFilter === "unassigned") return !c.assigned_to;
    return c.assigned_to === serverFilter;
  });

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
              Active Cases Management ({cases.length})
            </CardTitle>
            <CardDescription className="text-xs text-slate-500">
              Overview of all open cases, real-time server assignments, field sheets, and 1-click nudges.
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
      </CardHeader>

      <CardContent className="p-0">
        {loading ? (
          <div className="p-8 text-center text-slate-500">
            <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-blue-600" />
            <p className="text-xs">Loading active cases...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            <Briefcase className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm font-medium">No matching active cases found</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {search || serverFilter !== "all" ? "Try adjusting your search or filter." : "All cases are currently closed or served."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[520px] overflow-y-auto">
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
                      {item.client_name && (
                        <span className="text-[11px] text-slate-500">
                          · Client: <strong>{item.client_name}</strong>
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-slate-600 dark:text-slate-400 flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                      {item.home_address && (
                        <span className="truncate max-w-[280px]">
                          📍 {item.home_address}
                        </span>
                      )}
                      {item.documents_to_serve && (
                        <span className="text-slate-500 truncate max-w-[240px]">
                          📄 {item.documents_to_serve}
                        </span>
                      )}
                    </div>

                    {/* Assignment Status Chip */}
                    <div className="mt-2 flex items-center gap-2">
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
                    </div>
                  </div>

                  {/* Right: Action Buttons */}
                  <div className="flex items-center gap-2 shrink-0 flex-wrap self-end md:self-auto">
                    {/* 1-Click Field Sheet Modal & Print */}
                    <FieldSheetButton
                      caseId={caseId}
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
    </Card>
  );
}

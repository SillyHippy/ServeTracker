import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link, useNavigate } from "react-router-dom";
import { 
  Users, 
  Camera, 
  ClipboardList, 
  ArrowRight, 
  MapPin, 
  Clock, 
  CheckCircle, 
  AlertCircle, 
  Plus, 
  RefreshCw, 
  ChevronRight,
  Briefcase,
  FileText,
  Navigation,
  PenLine,
  UserCircle
} from "lucide-react";
import { ServeAttemptData } from "@/types/ServeAttemptData";
import { ClientData } from "@/components/ClientForm";
import ServeHistory from "@/components/ServeHistory";
import EditServeDialog from "@/components/EditServeDialog";
import MemoryMonitor from "@/components/MemoryMonitor";
import ServerWorkloadCard from "@/components/ServerWorkloadCard";
import SignatureEnrollmentDialog from "@/components/SignatureEnrollmentDialog";
import SignatureStatusBadge from "@/components/SignatureStatusBadge";
import FieldSheetButton from "@/components/FieldSheetButton";
import { CaseDocumentsDialog } from "@/components/CaseDocumentsDialog";
import { AffidavitSignatureQueue } from "@/components/AffidavitSignatureQueue";
import AffidavitGenerator from "@/components/AffidavitGenerator";
import NudgeServerDialog from "@/components/NudgeServerDialog";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { normalizeServeDataArray } from "@/utils/dataNormalization";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/context/AuthContext";

interface DashboardProps {
  clients: ClientData[];
  serves: ServeAttemptData[];
}

interface AssignedCase {
  id: string;
  case_number: string;
  case_name: string;
  court_name?: string;
  plaintiff_petitioner?: string;
  defendant_respondent?: string;
  home_address?: string;
  work_address?: string;
  documents_to_serve?: string;
  service_requirements?: string;
  contact_info?: string;
  notes?: string;
  status: string;
}

const Dashboard: React.FC<DashboardProps> = ({ clients: propClients }) => {
  const { user, isAdmin, isServer } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  
  const [recentServes, setRecentServes] = useState<ServeAttemptData[]>([]);
  const [assignedCases, setAssignedCases] = useState<AssignedCase[]>([]);
  const [activeDocCase, setActiveDocCase] = useState<{
    caseId: string;
    caseNumber: string;
    defendantName?: string;
    fieldSheetData?: any;
  } | null>(null);
  const [editingServe, setEditingServe] = useState<ServeAttemptData | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [clientsCount, setClientsCount] = useState(propClients?.length || 0);
  const [completedCount, setCompletedCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [todayCount, setTodayCount] = useState(0);
  const [unpaidSum, setUnpaidSum] = useState(0);
  const [unpaidCount, setUnpaidCount] = useState(0);
  const [paidSum, setPaidSum] = useState(0);
  const [paidCount, setPaidCount] = useState(0);
  const [signatureEnrolled, setSignatureEnrolled] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);

  useEffect(() => {
    fetchDashboardData();
  }, [propClients, user]);

  const fetchDashboardData = async () => {
    try {
      setIsLoading(true);

      if (isServer) {
        try {
          const me = await api.getMyProfile();
          const sig = (me as { signatureStatus?: { enrolled?: boolean; revoked?: boolean } }).signatureStatus;
          setSignatureEnrolled(!!sig?.enrolled && !sig?.revoked);
        } catch {
          setSignatureEnrolled(false);
        }
        // Fetch only assigned cases for this field server
        const casesRes = await api.getCases();
        if (Array.isArray(casesRes)) {
          setAssignedCases(
            casesRes.map((c: any) => ({
              id: c.id || c.$id,
              case_number: c.case_number || c.caseNumber || "",
              case_name: c.case_name || c.caseName || "",
              court_name: c.court_name || c.courtName || "",
              plaintiff_petitioner: c.plaintiff_petitioner || c.plaintiffPetitioner || "",
              defendant_respondent: c.defendant_respondent || c.defendantRespondent || "",
              home_address: c.home_address || c.homeAddress || "",
              work_address: c.work_address || c.workAddress || "",
              documents_to_serve: c.documents_to_serve || c.documentsToServe || "",
              notes: c.notes || "",
              status: c.status || "Open",
            }))
          );
        }
      } else {
        // Admin: fetch total clients & calculate A/R stats
        if (!propClients || propClients.length === 0) {
          const clientsRes = await api.getClients();
          if (clientsRes) setClientsCount(clientsRes.length);
        } else {
          setClientsCount(propClients.length);
        }
        try {
          const allCases = await api.getCases();
          if (Array.isArray(allCases)) {
            let unSum = 0;
            let unCnt = 0;
            let pdSum = 0;
            let pdCnt = 0;
            for (const c of allCases) {
              const fee = Number((c as any).quoted_fee || 0);
              const pStatus = String((c as any).payment_status || "").toUpperCase();
              if (pStatus === "UNPAID") {
                unSum += fee;
                unCnt += 1;
              } else if (pStatus === "PAID") {
                pdSum += fee;
                pdCnt += 1;
              }
            }
            setUnpaidSum(unSum);
            setUnpaidCount(unCnt);
            setPaidSum(pdSum);
            setPaidCount(pdCnt);
          }
        } catch (cErr) {
          console.error("Dashboard: Error fetching case financials:", cErr);
        }
      }

      // Fetch recent serve attempts
      const rawServes = await api.getServeAttempts(15, 0);

      if (rawServes && Array.isArray(rawServes)) {
        const normalizedServes = normalizeServeDataArray(rawServes);
        setRecentServes(normalizedServes);

        // Calculate stats
        const completed = normalizedServes.filter((s) => s.status === "completed" || s.status === "served").length;
        const pending = normalizedServes.filter((s) => s.status === "failed").length;
        setCompletedCount(completed);
        setPendingCount(pending);

        // Today's activity
        const todayStr = new Date().toDateString();
        const todayServes = normalizedServes.filter((s) => {
          if (!s.timestamp && !s.occurred_at) return false;
          const d = new Date(s.occurred_at || s.timestamp || "");
          return d.toDateString() === todayStr;
        });
        setTodayCount(todayServes.length);
      }
    } catch (error) {
      console.error("Dashboard: Error fetching data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditServe = (serve: ServeAttemptData) => {
    setEditingServe(serve);
    setEditDialogOpen(true);
  };

  const handleSaveServe = async (updatedServe: ServeAttemptData): Promise<boolean> => {
    try {
      const id = updatedServe.id || (updatedServe as any).$id;
      await api.updateServeAttempt(id, {
        status: updatedServe.status,
        notes: updatedServe.notes || "",
        serviceMethod: updatedServe.serviceMethod || updatedServe.service_method || "",
        service_method: updatedServe.serviceMethod || updatedServe.service_method || "",
        acceptedBy: updatedServe.acceptedBy || updatedServe.accepted_by || "",
        accepted_by: updatedServe.acceptedBy || updatedServe.accepted_by || "",
        postingLocation: updatedServe.postingLocation || updatedServe.posting_location || "",
        posting_location: updatedServe.postingLocation || updatedServe.posting_location || "",
        corporateAgent: updatedServe.corporateAgent || updatedServe.corporate_agent || updatedServe.entityName || updatedServe.entity_name || "",
        corporate_agent: updatedServe.corporateAgent || updatedServe.corporate_agent || updatedServe.entityName || updatedServe.entity_name || "",
        entityName: updatedServe.entityName || updatedServe.entity_name || updatedServe.corporateAgent || updatedServe.corporate_agent || "",
        entity_name: updatedServe.entityName || updatedServe.entity_name || updatedServe.corporateAgent || updatedServe.corporate_agent || "",
        recipientTitle: updatedServe.recipientTitle || updatedServe.recipient_title || "",
        recipient_title: updatedServe.recipientTitle || updatedServe.recipient_title || "",
      });
      toast({ title: "Serve updated", description: "Attempt details updated successfully" });
      fetchDashboardData();
      return true;
    } catch (error) {
      toast({ title: "Error", description: "Failed to update serve attempt", variant: "destructive" });
      return false;
    }
  };

  const handleDeleteServe = async (serveId: string): Promise<boolean> => {
    if (isServer) return false;
    try {
      await api.deleteServeAttempt(serveId);
      toast({ title: "Serve deleted", description: "Service attempt removed" });
      fetchDashboardData();
      return true;
    } catch (error) {
      toast({ title: "Error", description: "Failed to delete serve attempt", variant: "destructive" });
      return false;
    }
  };

  // ==========================================
  // FIELD SERVER VIEW (Restricted Mode)
  // ==========================================
  if (isServer) {
    const activeAssigned = assignedCases.filter((c) => {
      const s = (c.status || "").toLowerCase().replace(/[\s_]+/g, "-").trim();
      return (
        s !== "closed" &&
        s !== "completed" &&
        s !== "served" &&
        s !== "non-service" &&
        s !== "nonservice"
      );
    });

    return (
      <div className="w-full pb-16 touch-pan-y space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Assigned Field Cases
            </h1>
            <p className="text-slate-500 text-xs sm:text-sm">
              Server: <strong>{user?.displayName || user?.username}</strong> — Log attempts with live GPS and photos
            </p>
          </div>
          <Button
            size="sm"
            onClick={fetchDashboardData}
            variant="outline"
            disabled={isLoading}
            className="self-start sm:self-auto"
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        <Card className={signatureEnrolled ? "border-slate-200" : "border-amber-300 bg-amber-50/70"}>
          <CardContent className="py-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-slate-500">Login username</div>
              <div className="font-mono font-bold text-slate-900">@{user?.username}</div>
              <div className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                Signature: <SignatureStatusBadge status={signatureEnrolled ? "enrolled" : "none"} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={signatureEnrolled ? "outline" : "default"} onClick={() => setSigOpen(true)}>
                <PenLine className="h-4 w-4 mr-1" />
                {signatureEnrolled ? "Replace signature" : "Enroll signature"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate("/profile")}>
                <UserCircle className="h-4 w-4 mr-1" /> My Profile
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Affidavits Awaiting Signature Queue */}
        <AffidavitSignatureQueue />

        {/* Assigned Cases List */}
        <div>
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
              <Briefcase className="w-4 h-4 text-blue-600" /> Active Jobs ({activeAssigned.length})
            </h2>
          </div>

          {isLoading ? (
            <Card className="p-8 text-center border-slate-200">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
              <p className="text-xs text-slate-500">Loading your assigned cases...</p>
            </Card>
          ) : activeAssigned.length === 0 ? (
            <Card className="p-8 text-center border-slate-200 bg-slate-50">
              <Briefcase className="w-8 h-8 mx-auto mb-2 text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-800">No active cases assigned</h3>
              <p className="text-xs text-slate-500 mt-1">
                When an administrator assigns a case to you, it will appear here immediately.
              </p>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {activeAssigned.map((c) => {
                const targetName = c.defendant_respondent || c.case_name || "Target Recipient";
                return (
                  <Card key={c.id} className="border-slate-200 shadow-xs hover:shadow-md transition">
                    <CardHeader className="pb-2 bg-slate-50/50">
                      <div className="flex justify-between items-start">
                        <div>
                          <CardTitle className="text-base font-bold text-slate-900">{targetName}</CardTitle>
                          <CardDescription className="text-xs font-mono font-medium text-blue-700">
                            Case #{c.case_number}
                          </CardDescription>
                        </div>
                        <span className="text-[10px] uppercase font-bold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                          {c.status}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="py-3 space-y-2 text-xs">
                      {c.home_address && (
                        <div className="flex items-start gap-1.5 text-slate-700">
                          <MapPin className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-semibold text-slate-900">Service Address:</span>{" "}
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.home_address)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 underline font-medium"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {c.home_address}
                            </a>
                          </div>
                        </div>
                      )}
                      {c.work_address && (
                        <div className="flex items-start gap-1.5 text-slate-700">
                          <Navigation className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-semibold text-slate-900">Work/Alt:</span>{" "}
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.work_address)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800 underline font-medium"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {c.work_address}
                            </a>
                          </div>
                        </div>
                      )}
                      {c.documents_to_serve && (
                        <div className="flex items-start gap-1.5 text-slate-700 bg-slate-50 p-1.5 rounded">
                          <FileText className="h-3.5 w-3.5 text-slate-500 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-semibold">Documents:</span> {c.documents_to_serve}
                          </div>
                        </div>
                      )}
                      {c.service_requirements && (
                        <p className="text-slate-700 bg-blue-50/60 p-1.5 rounded border border-blue-100">
                          <span className="font-semibold text-blue-900">Requirements:</span> {c.service_requirements}
                        </p>
                      )}
                      {c.contact_info && (
                        <p className="text-slate-700">
                          <span className="font-semibold text-slate-900">Phone / Contact:</span> {c.contact_info}
                        </p>
                      )}
                      {c.notes && (
                        <p className="text-slate-600 bg-amber-50/50 p-1.5 rounded border border-amber-100">
                          <span className="font-semibold text-amber-900">Notes:</span> {c.notes}
                        </p>
                      )}
                    </CardContent>
                    <div className="p-3 border-t bg-slate-50/60 dark:bg-slate-900/60 space-y-2">
                      <div className="flex items-center gap-1.5 w-full min-w-0">
                        <div className="flex-1 min-w-0">
                          <FieldSheetButton
                            label="Field Sheet"
                            className="h-8.5 w-full justify-center px-1 text-[11px] font-semibold"
                            data={{
                              caseId: c.id,
                              caseNumber: c.case_number,
                              caseName: c.case_name,
                              courtName: c.court_name,
                              plaintiff: c.plaintiff_petitioner,
                              defendant: c.defendant_respondent,
                              documents: c.documents_to_serve,
                              requirements: (c as any).service_requirements,
                              contactInfo: (c as any).contact_info,
                              notes: c.notes,
                              homeAddress: c.home_address,
                              workAddress: c.work_address,
                              personToServe: targetName,
                              assignedServer: isServer ? (user?.displayName || user?.username || "") : "",
                              hideClient: isServer,
                            }}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="flex-1 min-w-0 h-8.5 justify-center px-1 text-[11px] font-semibold text-blue-700 bg-blue-50/70 hover:bg-blue-100 border-blue-200"
                          onClick={() =>
                            setActiveDocCase({
                              caseId: c.id,
                              caseNumber: c.case_number,
                              defendantName: targetName,
                              fieldSheetData: {
                                caseId: c.id,
                                caseNumber: c.case_number,
                                caseName: c.case_name,
                                courtName: c.court_name,
                                plaintiff: c.plaintiff_petitioner,
                                defendant: c.defendant_respondent,
                                documents: c.documents_to_serve,
                                requirements: (c as any).service_requirements,
                                contactInfo: (c as any).contact_info,
                                notes: c.notes,
                                homeAddress: c.home_address,
                                workAddress: c.work_address,
                                personToServe: targetName,
                                assignedServer: isServer ? (user?.displayName || user?.username || "") : "",
                                hideClient: isServer,
                              },
                            })
                          }
                        >
                          <FileText className="h-3.5 w-3.5 mr-1 text-blue-600 shrink-0" />
                          <span className="truncate">Service Docs</span>
                        </Button>
                        <div className="flex-1 min-w-0">
                          <AffidavitGenerator
                            buttonClassName="h-8.5 w-full justify-center px-1 text-[11px] font-semibold"
                            caseRecordId={c.id}
                            client={{ id: "", name: "Client", email: "", phone: "", address: "", notes: "" }}
                            serves={recentServes.filter(
                              (s) => String(s.caseNumber || s.case_number || "") === String(c.case_number)
                            )}
                            caseNumber={c.case_number}
                            caseName={c.case_name}
                            courtName={c.court_name}
                            plaintiffPetitioner={c.plaintiff_petitioner}
                            defendantRespondent={c.defendant_respondent}
                            homeAddress={c.home_address}
                            workAddress={c.work_address}
                            personBeingServed={targetName}
                            documentsToServe={c.documents_to_serve || ""}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isAdmin && (
                          <NudgeServerDialog
                            caseId={c.id}
                            caseNumber={c.case_number}
                            serverName={(c as any).assigned_server_name || (c as any).assignedServerName || (c as any).assigned_to_name}
                          />
                        )}
                        <Button
                          size="sm"
                          className="flex-1 h-11 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm flex items-center justify-center gap-1.5 shadow-xs"
                          onClick={() => {
                            const params = new URLSearchParams();
                            params.set("caseId", c.id);
                            params.set("caseNumber", c.case_number);
                            params.set("person", targetName);
                            if (c.home_address) params.set("address", c.home_address);
                            params.set("step", "confirm");
                            navigate(`/new-serve?${params.toString()}`);
                          }}
                        >
                          <Camera className="w-4 h-4" /> Log Attempt
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* My Recent Attempts */}
        <div className="space-y-3 pt-4 border-t">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-primary" /> My Recent Serve Attempts
            </h2>
            <Link to="/history">
              <Button variant="outline" size="sm" className="h-8 text-xs">
                View All <ChevronRight className="w-3 h-3 ml-1" />
              </Button>
            </Link>
          </div>

          {recentServes.length > 0 ? (
            <ServeHistory serves={recentServes} clients={[]} onEdit={handleEditServe} />
          ) : (
            <Card className="p-6 text-center text-xs text-slate-500">
              No serve attempts recorded yet. Click "Log Attempt" above to record your first field attempt.
            </Card>
          )}
        </div>

        <SignatureEnrollmentDialog
          open={sigOpen}
          onOpenChange={setSigOpen}
          onChanged={fetchDashboardData}
          existing={{ enrolled: signatureEnrolled }}
        />

        {editingServe && (
          <EditServeDialog
            serve={editingServe}
            open={editDialogOpen}
            onOpenChange={(open) => {
              setEditDialogOpen(open);
              if (!open) setEditingServe(null);
            }}
            onSave={handleSaveServe}
          />
        )}

        {activeDocCase && (
          <CaseDocumentsDialog
            caseId={activeDocCase.caseId}
            caseNumber={activeDocCase.caseNumber}
            defendantName={activeDocCase.defendantName}
            fieldSheetData={activeDocCase.fieldSheetData}
            open={Boolean(activeDocCase)}
            onOpenChange={(open) => {
              if (!open) setActiveDocCase(null);
            }}
          />
        )}
      </div>
    );
  }

  // ==========================================
  // ADMINISTRATOR VIEW
  // ==========================================
  return (
    <div className="w-full min-w-0 max-w-full pb-16 touch-pan-y">
      <MemoryMonitor />

      <div className="mb-6 text-center md:text-left">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-1 text-slate-900 dark:text-slate-100">
          Process Server Dashboard
        </h1>
        <p className="text-slate-500 text-xs md:text-sm">
          Track serve attempts, assign jobs to field servers, and view legal exhibits
        </p>
      </div>

      {/* Quick Action Bar for Mobile */}
      <div className="grid grid-cols-2 gap-2 mb-6 md:hidden">
        <Link to="/new-serve">
          <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold h-12 text-xs flex items-center justify-center gap-1.5 shadow-xs">
            <Plus className="w-4 h-4" /> Log New Serve
          </Button>
        </Link>
        <Link to="/clients">
          <Button variant="outline" className="w-full border-slate-300 dark:border-slate-700 h-12 text-xs font-bold flex items-center justify-center gap-1.5">
            <Users className="w-4 h-4 text-blue-600" /> Manage Clients
          </Button>
        </Link>
      </div>

      {/* Top Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
        <Card className="border border-slate-200 dark:border-slate-800 shadow-xs">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-500 text-xs font-semibold">Total Clients</p>
                <h2 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">{clientsCount}</h2>
              </div>
              <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
                <Users className="h-5 w-5" />
              </div>
            </div>
            <Link to="/clients">
              <Button variant="ghost" className="w-full mt-2 text-xs h-7 text-blue-600">
                Manage Clients <ChevronRight className="ml-1 h-3 w-3" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card className={`border shadow-xs ${unpaidCount > 0 ? "border-amber-300 bg-amber-50/40 dark:bg-amber-950/20" : "border-slate-200 dark:border-slate-800"}`}>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-500 text-xs font-semibold">Unpaid Invoices (A/R)</p>
                <h2 className="text-2xl md:text-3xl font-bold text-amber-700 dark:text-amber-400 mt-0.5">
                  ${unpaidSum.toFixed(2)}
                </h2>
              </div>
              <div className="p-2.5 rounded-xl bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300">
                <AlertCircle className="h-5 w-5" />
              </div>
            </div>
            <div className="flex items-center justify-between mt-2 pt-1 border-t border-amber-200/60 dark:border-amber-900/60">
              <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                {unpaidCount} case{unpaidCount === 1 ? "" : "s"} awaiting payment
              </span>
              <Link to="/billing?filter=unpaid">
                <Button variant="ghost" className="text-xs h-6 px-1.5 text-amber-800 font-bold hover:bg-amber-100">
                  View Unpaid <ChevronRight className="h-3 w-3 ml-0.5" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200 dark:border-slate-800 shadow-xs">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-500 text-xs font-semibold">Today's Activity</p>
                <h2 className="text-2xl md:text-3xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">{todayCount}</h2>
              </div>
              <div className="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-950 text-purple-600 dark:text-purple-400">
                <Clock className="h-5 w-5" />
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              {todayCount === 0 ? "No serve attempts today" : `${todayCount} attempt(s) logged today`}
            </p>
          </CardContent>
        </Card>

        <Card className="border border-slate-200 dark:border-slate-800 shadow-xs">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-500 text-xs font-semibold">Total Collected</p>
                <h2 className="text-2xl md:text-3xl font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">
                  ${paidSum.toFixed(2)}
                </h2>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
                <CheckCircle className="h-5 w-5" />
              </div>
            </div>
            <div className="flex items-center justify-between mt-2 pt-1 border-t border-emerald-200/60 dark:border-emerald-900/60">
              <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                {paidCount} paid invoice{paidCount === 1 ? "" : "s"} recorded
              </span>
              <Link to="/billing?filter=paid">
                <Button variant="ghost" className="text-xs h-6 px-1.5 text-emerald-800 font-bold hover:bg-emerald-50">
                  View Paid <ChevronRight className="h-3 w-3 ml-0.5" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Field Server Workload (admin only) */}
      <ServerWorkloadCard />

      <div className="mb-6">
        <AffidavitSignatureQueue />
      </div>

      {/* Recent Activity List */}
      <div className="space-y-4">
        <div className="flex flex-wrap justify-between items-center gap-2">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 min-w-0">
            <ClipboardList className="w-5 h-5 shrink-0 text-blue-600" /> Recent Serve Attempts
          </h2>
          <Link to="/history" className="shrink-0">
            <Button variant="outline" size="sm" className="h-8 text-xs font-semibold">
              View All History <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          </Link>
        </div>

        {isLoading ? (
          <Card className="p-8 text-center border border-slate-200 dark:border-slate-800">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
            <p className="text-xs text-slate-500">Loading recent serve attempts...</p>
          </Card>
        ) : recentServes.length > 0 ? (
          <ServeHistory
            serves={recentServes}
            clients={propClients || []}
            onEdit={handleEditServe}
            onDelete={(id) => { void handleDeleteServe(id); }}
          />
        ) : (
          <Card className="p-8 text-center border border-slate-200 dark:border-slate-800">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No serve attempts logged yet</p>
            <p className="text-xs text-slate-500 mt-1 mb-4">Start logging serve attempts to track field activity here.</p>
            <Link to="/new-serve">
              <Button size="sm" className="bg-blue-600 text-white font-bold">
                Log First Serve Attempt
              </Button>
            </Link>
          </Card>
        )}
      </div>

      {editingServe && (
        <EditServeDialog
          serve={editingServe}
          open={editDialogOpen}
          onOpenChange={(open) => {
            setEditDialogOpen(open);
            if (!open) setEditingServe(null);
          }}
          onSave={handleSaveServe}
        />
      )}

      {activeDocCase && (
        <CaseDocumentsDialog
          caseId={activeDocCase.caseId}
          caseNumber={activeDocCase.caseNumber}
          defendantName={activeDocCase.defendantName}
          fieldSheetData={activeDocCase.fieldSheetData}
          open={Boolean(activeDocCase)}
          onOpenChange={(open) => {
            if (!open) setActiveDocCase(null);
          }}
        />
      )}
    </div>
  );
};

export default Dashboard;

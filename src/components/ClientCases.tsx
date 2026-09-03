import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Plus, FileText, Edit, Trash2, Upload, FolderOpen, MapPin, Navigation, Copy, Mail, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { api, API_BASE } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { ClientData } from "./ClientForm";
import ClientDocuments from "./ClientDocuments";
import { CaseDocumentsDialog } from "./CaseDocumentsDialog";
import ServeHistory from "./ServeHistory";
import AffidavitGenerator from "./AffidavitGenerator";
import FieldSheetButton from "./FieldSheetButton";
import NudgeServerDialog from "./NudgeServerDialog";
import EditCaseDialog from "./EditCaseDialog";
import ServerAssignmentPanel from "./ServerAssignmentPanel";
import MarkPaidDialog from "./MarkPaidDialog";
import { mergeServeAndCaseData } from "@/utils/dataNormalization";
import { ServeAttemptData } from "@/types/ServeAttemptData";

interface ClientCase {
  $id: string;
  client_id: string;
  case_number: string;
  case_name: string;
  court_name?: string;
  plaintiff_petitioner?: string;
  defendant_respondent?: string;
  notes?: string;
  status: string;
  created_at: string;
  updated_at: string;
  home_address?: string;
  work_address?: string;
  documents_to_serve?: string;
  assigned_to?: string;
  assigned_name?: string;
  service_requirements?: string;
  contact_info?: string;
  quoted_fee?: string | number;
  invoice_id?: string;
  invoice_number?: string;
  pay_url?: string;
  payment_status?: string;
  paid_at?: string;
  payment_method?: string;
  payment_notes?: string;
}

interface ClientCasesProps {
  client: ClientData;
  onUpdate: () => void;
  clientCases?: ClientCase[];
  setClientCases?: (cases: ClientCase[]) => void;
}

export default function ClientCases({ client, onUpdate, clientCases = [], setClientCases }: ClientCasesProps) {
  const [serves, setServes] = useState<ServeAttemptData[]>([]);
  const [activeDocCase, setActiveDocCase] = useState<{ caseId: string; caseNumber: string; defendantName: string } | null>(null);
  const [assignOptions, setAssignOptions] = useState<Array<{ id: string; label: string; ineligible?: string }>>([]);
  const [markPaidTarget, setMarkPaidTarget] = useState<ClientCase | null>(null);
  const [newCase, setNewCase] = useState({
    case_number: "",
    case_name: "",
    court_name: "",
    plaintiff_petitioner: "",
    defendant_respondent: "",
    home_address: "",
    work_address: "",
    documents_to_serve: "",
    notes: "",
    service_requirements: "",
    contact_info: "",
    status: "active",
    assigned_to: "",
    assigned_name: "",
    quoted_fee: "",
    create_invoice: false,
    email_invoice: false,
  });
  const [newCaseFiles, setNewCaseFiles] = useState<File[]>([]);
  const [additionalRecipients, setAdditionalRecipients] = useState<string[]>([]);
  const [isAddingCase, setIsAddingCase] = useState(false);
  const [isSubmittingCase, setIsSubmittingCase] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    api.getServerWorkload()
      .then((res) => {
        const opts = (res.servers || [])
          .filter((s) => s.isActive !== false)
          .map((s) => {
          let ineligible: string | undefined;
          if (s.role !== "admin") {
            if (!s.isActive) ineligible = "inactive";
            else if (s.onboardingStatus !== "active") ineligible = s.onboardingStatus;
            else if (s.licenseStatus === "expired") ineligible = "license expired";
          }
          const label = s.role === "admin"
            ? `${s.displayName} (Admin @${s.username})`
            : `${s.displayName} (@${s.username})`;
          return { id: s.id, label, ineligible };
        });
        setAssignOptions(opts);
      })
      .catch(() => {});
  }, []);

  // Fetch serves for this client
  useEffect(() => {
    const fetchServes = async () => {
      try {
        console.log("Fetching serves for client:", client.id);
        const allServes = await api.getServeAttempts();
        const clientServes = allServes.filter(serve => serve.clientId === client.id);
        console.log("Client serves:", clientServes);
        setServes(clientServes as ServeAttemptData[]);
      } catch (error) {
        console.error("Error fetching serves:", error);
        setServes([]);
      }
    };

    if (client.id) {
      fetchServes();
    }
  }, [client.id]);

  const handleCreateCase = async () => {
    setIsSubmittingCase(true);
    try {
      console.log("Creating new case:", newCase);
      // case_name = Person Being Served (legacy field name kept for DB)
      const personBeingServed = (newCase.case_name || newCase.defendant_respondent || "").trim();
      const validAdditional = additionalRecipients.map((s) => s.trim()).filter(Boolean);
      const allRecipients = [personBeingServed, ...validAdditional].filter(Boolean).map((name) => ({
        full_name: name,
        role: "Defendant / Respondent",
      }));
      const combinedDefendants = allRecipients.length > 1
        ? allRecipients.map((r) => r.full_name).join(" & ")
        : (newCase.defendant_respondent || personBeingServed).trim();

      const caseData = {
        client_id: client.id,
        ...newCase,
        case_name: personBeingServed,
        // Keep defendant in sync when blank so New Serve defaults correctly
        defendant_respondent: combinedDefendants,
        recipients: allRecipients,
        status: newCase.status || "active",
      };
      
      const createdCase = await api.createCase(caseData);
      console.log("Case created:", createdCase);
      
      // If files were selected, upload them now
      const cId = (createdCase as any)?.id || (createdCase as any)?.$id;
      if (newCaseFiles.length > 0 && cId) {
        let uploadedCount = 0;
        for (const file of newCaseFiles) {
          const form = new FormData();
          form.append("file", file);
          form.append("description", newCase.documents_to_serve || "Court Document");
          const uploadRes = await fetch(`${API_BASE}/api/cases/${cId}/documents`, {
            method: "POST",
            body: form,
            credentials: "include",
          });
          if (uploadRes.ok) uploadedCount++;
        }
        toast({
          title: "Case & Documents Created 📄",
          description: `Case added with ${uploadedCount} attached court document(s).`,
        });
      } else {
        toast({
          title: "Case created",
          description: "New case has been added successfully",
          variant: "default",
        });
      }

      if (setClientCases) {
        setClientCases([...clientCases, createdCase]);
      }
      
      setNewCase({
        case_number: "",
        case_name: "",
        court_name: "",
        plaintiff_petitioner: "",
        defendant_respondent: "",
        home_address: "",
        work_address: "",
        documents_to_serve: "",
        notes: "",
        service_requirements: "",
        contact_info: "",
        status: "active",
        assigned_to: "",
        assigned_name: "",
        quoted_fee: "",
        create_invoice: false,
        email_invoice: false,
      });
      setNewCaseFiles([]);
      setIsAddingCase(false);
      onUpdate();
    } catch (error) {
      console.error("Error creating case:", error);
      toast({
        title: "Error",
        description: "Failed to create case. Please check required fields.",
        variant: "destructive",
      });
    } finally {
      setIsSubmittingCase(false);
    }
  };

  const updateCase = async (caseData: any) => {
    try {
      console.log("Updating case:", caseData);
      const updatedCase = await api.updateCase(caseData.id, caseData);
      console.log("Case updated:", updatedCase);
      
      if (setClientCases) {
        setClientCases(clientCases.map(c => c.$id === caseData.id ? updatedCase : c));
      }
      
      toast({
        title: "Case updated",
        description: "Case has been updated successfully",
        variant: "default",
      });
    } catch (error) {
      console.error("Error updating case:", error);
      toast({
        title: "Error updating case",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const deleteCase = async (caseId: string) => {
    try {
      await api.deleteClientCase(caseId);
      if (setClientCases) {
        setClientCases(clientCases.filter(c => c.$id !== caseId));
      }
      toast({
        title: "Case deleted",
        description: "Case has been removed successfully",
        variant: "default",
      });
    } catch (error) {
      console.error("Error deleting case:", error);
      toast({
        title: "Error deleting case",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const deleteServe = async (serveId: string) => {
    try {
      await api.deleteServeAttempt(serveId);
      setServes(prev => prev.filter(s => s.id !== serveId));
      toast({
        title: "Serve deleted",
        description: "Service attempt has been removed",
        variant: "default",
      });
    } catch (error) {
      console.error("Error deleting serve:", error);
      toast({
        title: "Error deleting serve",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const updateServe = async (serveData: any) => {
    try {
      await api.updateServeAttempt(serveData.id, serveData);
      // Refresh serves
      const allServes = await api.getServeAttempts();
      const clientServes = allServes.filter(serve => serve.clientId === client.id);
      setServes(clientServes as ServeAttemptData[]);
      toast({
        title: "Serve updated",
        description: "Service attempt has been updated successfully",
        variant: "default",
      });
    } catch (error) {
      console.error("Error updating serve:", error);
      toast({
        title: "Error updating serve",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const mergedServes = mergeServeAndCaseData(serves, clientCases);

  return (
    <div className="space-y-6">
      <Tabs defaultValue="cases" className="w-full">
        <TabsList>
          <TabsTrigger value="cases">Cases</TabsTrigger>
          <TabsTrigger value="serves">Service History</TabsTrigger>
          <TabsTrigger value="documents">General Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="cases" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium">Client Cases</h3>
            <Dialog open={isAddingCase} onOpenChange={setIsAddingCase}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Case
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Add New Case</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="case_number">Case Number</Label>
                    <Input
                      id="case_number"
                      value={newCase.case_number}
                      onChange={(e) => setNewCase(prev => ({ ...prev, case_number: e.target.value }))}
                      placeholder="e.g. PG-26-22"
                    />
                  </div>
                  {/* Person(s) Being Served Section */}
                  <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 space-y-3">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="case_name" className="font-semibold text-xs flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
                        <Users className="w-4 h-4 text-blue-600" />
                        People Being Served at this Address ({additionalRecipients.length + 1})
                      </Label>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs flex items-center gap-1 border-blue-200 text-blue-700 hover:bg-blue-50"
                        onClick={() => setAdditionalRecipients(prev => [...prev, ""])}
                      >
                        <Plus className="w-3 h-3" />
                        Add Person
                      </Button>
                    </div>
                    <div>
                      <Input
                        id="case_name"
                        value={newCase.case_name}
                        onChange={(e) => {
                          const v = e.target.value;
                          setNewCase(prev => ({
                            ...prev,
                            case_name: v,
                            defendant_respondent:
                              !prev.defendant_respondent || prev.defendant_respondent === prev.case_name
                                ? v
                                : prev.defendant_respondent,
                          }));
                        }}
                        placeholder="Primary Person Being Served (full name)"
                        className="h-9 text-xs"
                      />
                    </div>
                    {additionalRecipients.map((recName, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <div className="flex-1">
                          <Input
                            value={recName}
                            onChange={(e) => {
                              const v = e.target.value;
                              setAdditionalRecipients(prev => {
                                const copy = [...prev];
                                copy[idx] = v;
                                return copy;
                              });
                            }}
                            placeholder={`Person #${idx + 2} (e.g. spouse, co-defendant)`}
                            className="h-9 text-xs"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-9 w-9 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0"
                          onClick={() => setAdditionalRecipients(prev => prev.filter((_, i) => i !== idx))}
                          title="Remove person"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                    <p className="text-[11px] text-muted-foreground">
                      Each person added at this address will get their own separate selectable Affidavit upon completion or non-service.
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="court_name">Court Name (full caption)</Label>
                    <Input
                      id="court_name"
                      value={newCase.court_name}
                      onChange={(e) => setNewCase(prev => ({ ...prev, court_name: e.target.value }))}
                      placeholder="IN THE DISTRICT COURT IN AND FOR TULSA COUNTY STATE OF OKLAHOMA"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Full court line for affidavits — not just a county. Out-of-state OK (e.g. Circuit Court…).
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="documents_to_serve">Documents to Serve</Label>
                    <Textarea
                      id="documents_to_serve"
                      value={newCase.documents_to_serve}
                      onChange={(e) => setNewCase(prev => ({ ...prev, documents_to_serve: e.target.value }))}
                      placeholder="Summons, Petition, … (exact titles from cover sheet)"
                      className="min-h-[70px]"
                    />
                  </div>
                  <div>
                    <Label htmlFor="plaintiff_petitioner">Plaintiff/Petitioner</Label>
                    <Input
                      id="plaintiff_petitioner"
                      value={newCase.plaintiff_petitioner}
                      onChange={(e) => setNewCase(prev => ({ ...prev, plaintiff_petitioner: e.target.value }))}
                      placeholder="Plaintiff / Petitioner"
                    />
                  </div>
                  <div>
                    <Label htmlFor="defendant_respondent">Defendant/Respondent (caption)</Label>
                    <Input
                      id="defendant_respondent"
                      value={newCase.defendant_respondent}
                      onChange={(e) => setNewCase(prev => ({ ...prev, defendant_respondent: e.target.value }))}
                      placeholder="Usually same as Person Being Served"
                    />
                  </div>
                  <div>
                    <Label htmlFor="home_address">Home Address</Label>
                    <Input
                      id="home_address"
                      value={newCase.home_address}
                      onChange={(e) => setNewCase(prev => ({ ...prev, home_address: e.target.value }))}
                      placeholder="Primary service address"
                    />
                  </div>
                  <div>
                    <Label htmlFor="work_address">Secondary Address</Label>
                    <Input
                      id="work_address"
                      value={newCase.work_address}
                      onChange={(e) => setNewCase(prev => ({ ...prev, work_address: e.target.value }))}
                      placeholder="Work, alternate, or 2nd location"
                    />
                  </div>
                  <div>
                    <Label htmlFor="service_requirements">Case Requirements</Label>
                    <Textarea
                      id="service_requirements"
                      value={newCase.service_requirements}
                      onChange={(e) => setNewCase(prev => ({ ...prev, service_requirements: e.target.value }))}
                      placeholder="Personal only, 3 attempts, posting authorized, gated community, etc."
                    />
                  </div>
                  <div>
                    <Label htmlFor="contact_info">Possible Phone / Contact</Label>
                    <Textarea
                      id="contact_info"
                      value={newCase.contact_info}
                      onChange={(e) => setNewCase(prev => ({ ...prev, contact_info: e.target.value }))}
                      placeholder="Known numbers, roommate, employer, gate, neighbor"
                    />
                  </div>
                  <div>
                    <Label htmlFor="notes">Notes</Label>
                    <Textarea
                      id="notes"
                      value={newCase.notes}
                      onChange={(e) => setNewCase(prev => ({ ...prev, notes: e.target.value }))}
                      placeholder="Enter case notes"
                    />
                  </div>
                  <div>
                    <Label htmlFor="quoted_fee">Quoted fee (optional)</Label>
                    <Input
                      id="quoted_fee"
                      type="number"
                      min="0"
                      step="0.01"
                      value={newCase.quoted_fee}
                      onChange={(e) => setNewCase(prev => ({ ...prev, quoted_fee: e.target.value }))}
                      placeholder="e.g. 110"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={!!newCase.create_invoice}
                      onCheckedChange={(v) => setNewCase(prev => ({ ...prev, create_invoice: v === true }))}
                    />
                    Create Helcim invoice
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={!!newCase.email_invoice}
                      onCheckedChange={(v) => setNewCase(prev => ({ ...prev, email_invoice: v === true }))}
                    />
                    Email invoice link to client
                  </label>

                  {/* Multi-File Document Upload */}
                  <div className="p-3 bg-blue-50/70 dark:bg-blue-950/40 rounded-lg border border-blue-200 dark:border-blue-800 space-y-2">
                    <Label htmlFor="new_case_docs" className="text-xs font-semibold text-blue-900 dark:text-blue-200 flex items-center gap-1.5">
                      <FileText className="h-4 w-4 text-blue-600" />
                      Attach Court Documents / Summons (Multi-file allowed)
                    </Label>
                    <Input
                      id="new_case_docs"
                      type="file"
                      multiple
                      accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                      onChange={(e) => {
                        if (e.target.files) {
                          setNewCaseFiles(Array.from(e.target.files));
                        }
                      }}
                      className="bg-white dark:bg-slate-900 text-xs h-9 file:text-xs file:py-0"
                    />
                    {newCaseFiles.length > 0 && (
                      <p className="text-[11px] text-blue-700 dark:text-blue-300 font-medium">
                        ✓ {newCaseFiles.length} document(s) ready to upload: {newCaseFiles.map((f) => f.name).join(", ")}
                      </p>
                    )}
                  </div>

                  <Button onClick={handleCreateCase} disabled={isSubmittingCase} className="w-full bg-blue-600 hover:bg-blue-700 font-semibold">
                    {isSubmittingCase ? "Creating Case & Uploading..." : "Create Case"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-4">
            {clientCases.map((clientCase) => {
              // Filter serves for this specific case
              const caseServes = serves.filter(serve => serve.caseNumber === clientCase.case_number);
              
              return (
                <Card key={clientCase.$id} className="w-full min-w-0 overflow-hidden shadow-sm">
                  <CardHeader className="space-y-3 p-3.5 sm:p-5">
                    <CardTitle className="text-base font-bold leading-snug pr-1 break-words flex items-center gap-2 flex-wrap">
                      {clientCase.case_name}
                      {clientCase.payment_status === "UNPAID" && (
                        <Badge className="bg-yellow-400 text-yellow-950 hover:bg-yellow-400">UNPAID</Badge>
                      )}
                      {clientCase.payment_status === "PAID" && (
                        <Badge className="bg-green-600 text-white hover:bg-green-600">PAID</Badge>
                      )}
                    </CardTitle>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 w-full min-w-0">
                      <FieldSheetButton
                        label="Field Sheet"
                        className="h-9 w-full justify-center px-1 text-[11px] font-semibold"
                        data={{
                          caseId: clientCase.$id || (clientCase as any).id,
                          caseNumber: clientCase.case_number,
                          caseName: clientCase.case_name,
                          courtName: clientCase.court_name,
                          plaintiff: clientCase.plaintiff_petitioner,
                          defendant: clientCase.defendant_respondent,
                          documents: clientCase.documents_to_serve || "",
                          notes: clientCase.notes,
                          requirements: clientCase.service_requirements || "",
                          contactInfo: clientCase.contact_info || "",
                          homeAddress: clientCase.home_address,
                          workAddress: clientCase.work_address,
                          personToServe: clientCase.defendant_respondent || clientCase.case_name,
                          assignedServer: clientCase.assigned_name,
                          clientName: client.name,
                          clientPhone: client.phone,
                          clientId: client.id,
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 w-full justify-center px-1 text-[11px] font-semibold text-blue-700 bg-blue-50/60 hover:bg-blue-100 border-blue-200"
                        onClick={() =>
                          setActiveDocCase({
                            caseId: clientCase.$id || (clientCase as any).id,
                            caseNumber: clientCase.case_number,
                            defendantName: clientCase.defendant_respondent || clientCase.case_name,
                          })
                        }
                      >
                        <FileText className="h-3.5 w-3.5 mr-1 text-blue-600 shrink-0" />
                        <span className="truncate">Case Documents</span>
                      </Button>
                      <AffidavitGenerator
                        buttonClassName="h-9 w-full justify-center px-1 text-[11px] font-semibold"
                        caseRecordId={clientCase.$id || (clientCase as any).id}
                        client={client}
                        serves={caseServes}
                        caseNumber={clientCase.case_number}
                        caseName={clientCase.case_name}
                        courtName={clientCase.court_name}
                        plaintiffPetitioner={clientCase.plaintiff_petitioner}
                        defendantRespondent={clientCase.defendant_respondent}
                        homeAddress={clientCase.home_address}
                        workAddress={clientCase.work_address}
                        personBeingServed={clientCase.defendant_respondent || clientCase.case_name}
                        documentsToServe={clientCase.documents_to_serve || ""}
                      />
                      <EditCaseDialog
                        clientCase={clientCase}
                        onUpdate={updateCase}
                        className="h-9 w-full justify-center px-1 text-[11px] font-semibold"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => deleteCase(clientCase.$id)}
                        className="h-9 w-full justify-center px-1 text-[11px] font-semibold hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1 shrink-0" />
                        <span className="truncate">Delete</span>
                      </Button>
                      {clientCase.pay_url && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 w-full justify-center px-1 text-[11px] font-semibold"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(String(clientCase.pay_url));
                              toast({ title: "Payment link copied" });
                            } catch {
                              toast({ title: "Copy failed", variant: "destructive" });
                            }
                          }}
                        >
                          <Copy className="h-3.5 w-3.5 mr-1 shrink-0" />
                          Copy pay link
                        </Button>
                      )}
                      {clientCase.pay_url && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 w-full justify-center px-1 text-[11px] font-semibold"
                          onClick={async () => {
                            try {
                              await api.resendCaseInvoiceEmail(clientCase.$id || (clientCase as any).id);
                              toast({ title: "Invoice email queued (staging skips live send)" });
                            } catch (e) {
                              toast({ title: "Send failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
                            }
                          }}
                        >
                          <Mail className="h-3.5 w-3.5 mr-1 shrink-0" />
                          Send invoice email
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={`h-9 w-full justify-center px-1 text-[11px] font-semibold ${
                          clientCase.payment_status === "PAID"
                            ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                            : "border-amber-300 text-amber-800 hover:bg-amber-50"
                        }`}
                        onClick={() => setMarkPaidTarget(clientCase)}
                      >
                        {clientCase.payment_status === "PAID" ? "Payment Details" : "Record Payment"}
                      </Button>
                      {clientCase.assigned_to && (
                        <NudgeServerDialog
                          caseId={clientCase.$id || (clientCase as any).id}
                          caseNumber={clientCase.case_number}
                          serverName={clientCase.assigned_name}
                          compact
                        />
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="p-3.5 sm:p-5 pt-0">
                    <div className="space-y-4">
                      <div className="space-y-2 text-sm break-words">
                        <p><strong>Case Number:</strong> {clientCase.case_number}</p>
                        {clientCase.court_name && (
                          <p><strong>Court:</strong> {clientCase.court_name}</p>
                        )}
                        {clientCase.plaintiff_petitioner && (
                          <p><strong>Plaintiff/Petitioner:</strong> {clientCase.plaintiff_petitioner}</p>
                        )}
                        {clientCase.defendant_respondent && (
                          <p><strong>Defendant/Respondent:</strong> {clientCase.defendant_respondent}</p>
                        )}
                        {clientCase.home_address && (
                          <p className="flex items-start gap-1.5 text-slate-800">
                            <MapPin className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                            <span>
                              <strong>Service Address:</strong>{" "}
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clientCase.home_address)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-800 underline font-medium"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {clientCase.home_address}
                              </a>
                            </span>
                          </p>
                        )}
                        {clientCase.work_address && (
                          <p className="flex items-start gap-1.5 text-slate-800">
                            <Navigation className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                            <span>
                              <strong>Work/Alt Address:</strong>{" "}
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clientCase.work_address)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-800 underline font-medium"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {clientCase.work_address}
                              </a>
                            </span>
                          </p>
                        )}
                        {clientCase.documents_to_serve && (
                          <p><strong>Documents to Serve:</strong> {clientCase.documents_to_serve}</p>
                        )}
                        {clientCase.service_requirements && (
                          <p><strong>Case Requirements:</strong> {clientCase.service_requirements}</p>
                        )}
                        {clientCase.contact_info && (
                          <p><strong>Possible Phone / Contact:</strong> {clientCase.contact_info}</p>
                        )}
                        {clientCase.notes && (
                          <p><strong>Notes:</strong> {clientCase.notes}</p>
                        )}
                        <p>
                          <strong>Assigned server:</strong>{" "}
                          {clientCase.assigned_name || (clientCase.assigned_to ? clientCase.assigned_to : "Unassigned")}
                        </p>
                        <p><strong>Service Attempts:</strong> {caseServes.length}</p>
                        <div className="pt-1">
                          <ServerAssignmentPanel
                            caseId={clientCase.$id || (clientCase as any).id}
                            currentAssignedId={clientCase.assigned_to || ""}
                            currentAssignedName={clientCase.assigned_name || ""}
                            servers={assignOptions}
                            onChanged={onUpdate}
                            compact
                          />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            
            {clientCases.length === 0 && (
              <Card>
                <CardContent className="text-center py-8">
                  <p className="text-muted-foreground">No cases found for this client.</p>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="serves" className="space-y-4">
          <h3 className="text-lg font-medium">Service History</h3>
          <ServeHistory 
            serves={mergedServes} 
            clients={[client]}
            onDelete={deleteServe}
            onEdit={updateServe}
          />
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          <div className="mb-4">
            <h3 className="text-lg font-medium mb-1">General Client Documents</h3>
            <p className="text-sm text-muted-foreground">
              Documents that belong to {client.name} but are not specific to any case. 
              For case-specific documents, expand the "Case Documents" section within each case above.
            </p>
          </div>
          <ClientDocuments clientId={client.id} clientName={client.name} />
        </TabsContent>
      </Tabs>

      {activeDocCase && (
        <CaseDocumentsDialog
          caseId={activeDocCase.caseId}
          caseNumber={activeDocCase.caseNumber}
          defendantName={activeDocCase.defendantName}
          open={Boolean(activeDocCase)}
          onOpenChange={(open) => {
            if (!open) setActiveDocCase(null);
          }}
        />
      )}

      <MarkPaidDialog
        open={Boolean(markPaidTarget)}
        onOpenChange={(open) => !open && setMarkPaidTarget(null)}
        caseItem={markPaidTarget ? {
          id: markPaidTarget.$id || (markPaidTarget as any).id,
          case_number: markPaidTarget.case_number,
          case_name: markPaidTarget.case_name,
          defendant_respondent: markPaidTarget.defendant_respondent,
          quoted_fee: markPaidTarget.quoted_fee,
          payment_status: markPaidTarget.payment_status,
          payment_method: markPaidTarget.payment_method,
          payment_notes: markPaidTarget.payment_notes,
        } : null}
        onSuccess={onUpdate}
      />
    </div>
  );
}

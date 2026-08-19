import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Plus, FileText, Edit, Trash2, Upload, FolderOpen } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { ClientData } from "./ClientForm";
import ClientDocuments from "./ClientDocuments";
import ServeHistory from "./ServeHistory";
import AffidavitGenerator from "./AffidavitGenerator";
import FieldSheetButton from "./FieldSheetButton";
import NudgeServerDialog from "./NudgeServerDialog";
import EditCaseDialog from "./EditCaseDialog";
import ServerAssignmentPanel from "./ServerAssignmentPanel";
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
}

interface ClientCasesProps {
  client: ClientData;
  onUpdate: () => void;
  clientCases?: ClientCase[];
  setClientCases?: (cases: ClientCase[]) => void;
}

export default function ClientCases({ client, onUpdate, clientCases = [], setClientCases }: ClientCasesProps) {
  const [serves, setServes] = useState<ServeAttemptData[]>([]);
  const [assignOptions, setAssignOptions] = useState<Array<{ id: string; label: string; ineligible?: string }>>([]);
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
  });
  const [isAddingCase, setIsAddingCase] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    api.getServerWorkload()
      .then((res) => {
        const opts = (res.servers || []).map((s) => {
          let ineligible: string | undefined;
          if (!s.isActive) ineligible = "inactive";
          else if (s.onboardingStatus !== "active") ineligible = s.onboardingStatus;
          else if (s.licenseStatus === "expired") ineligible = "license expired";
          return { id: s.id, label: `${s.displayName} (@${s.username})`, ineligible };
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
    try {
      console.log("Creating new case:", newCase);
      // case_name = Person Being Served (legacy field name kept for DB)
      const personBeingServed = (newCase.case_name || newCase.defendant_respondent || "").trim();
      const caseData = {
        client_id: client.id,
        ...newCase,
        case_name: personBeingServed,
        // Keep defendant in sync when blank so New Serve defaults correctly
        defendant_respondent: (newCase.defendant_respondent || personBeingServed).trim(),
        status: newCase.status || "active",
      };
      
      const createdCase = await api.createCase(caseData);
      console.log("Case created:", createdCase);
      
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
      });
      setIsAddingCase(false);
      
      toast({
        title: "Case created",
        description: "New case has been added successfully",
        variant: "default",
      });
    } catch (error) {
      console.error("Error creating case:", error);
      toast({
        title: "Error creating case",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
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
                  <div>
                    <Label htmlFor="case_name">Person Being Served</Label>
                    <Input
                      id="case_name"
                      value={newCase.case_name}
                      onChange={(e) => {
                        const v = e.target.value;
                        setNewCase(prev => ({
                          ...prev,
                          case_name: v,
                          // Keep defendant caption aligned unless user already typed a different one
                          defendant_respondent:
                            !prev.defendant_respondent || prev.defendant_respondent === prev.case_name
                              ? v
                              : prev.defendant_respondent,
                        }));
                      }}
                      placeholder="Who are you serving? (full name)"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      This is the default name shown on New Serve attempts.
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
                  <Button onClick={handleCreateCase} className="w-full">
                    Create Case
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
                <Card key={clientCase.$id}>
                  <CardHeader className="space-y-3">
                    <CardTitle className="text-base leading-snug pr-1">
                      {clientCase.case_name}
                    </CardTitle>
                    <div className="flex flex-wrap items-center gap-2">
                      <FieldSheetButton
                        className="h-10"
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
                      {caseServes.length > 0 && (
                        <AffidavitGenerator
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
                      )}
                      <EditCaseDialog
                        clientCase={clientCase}
                        onUpdate={updateCase}
                      />
                      {clientCase.assigned_to && (
                        <NudgeServerDialog
                          caseId={clientCase.$id || (clientCase as any).id}
                          caseNumber={clientCase.case_number}
                          serverName={clientCase.assigned_name}
                        />
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => deleteCase(clientCase.$id)}
                        className="h-10 px-3 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="space-y-2 text-sm">
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
                      
                      {/* Case-specific documents section */}
                      <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="case-documents" className="border rounded-lg px-4">
                          <AccordionTrigger className="hover:no-underline">
                            <div className="flex items-center gap-2">
                              <FolderOpen className="h-4 w-4" />
                              <span>Case Documents</span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="pt-2">
                              <ClientDocuments 
                                clientId={client.id}
                                clientName={client.name}
                                caseNumber={clientCase.case_number}
                                hideHeader={true}
                              />
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
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
    </div>
  );
}

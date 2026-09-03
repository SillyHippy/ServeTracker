import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Edit, UserCheck, Plus, Trash2, Users } from "lucide-react";
import { api } from "@/lib/api";

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

interface EditCaseDialogProps {
  clientCase: ClientCase;
  onUpdate: (caseData: any) => Promise<void>;
  isLoading?: boolean;
  className?: string;
}

interface UserOption {
  id: string;
  username: string;
  displayName: string;
  role: string;
}

interface RecipientEntry {
  id?: string;
  full_name: string;
  role: string;
}

export default function EditCaseDialog({ clientCase, onUpdate, isLoading, className }: EditCaseDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [availableServers, setAvailableServers] = useState<UserOption[]>([]);
  const [recipients, setRecipients] = useState<RecipientEntry[]>([]);
  const [caseData, setCaseData] = useState({
    case_number: clientCase.case_number || "",
    case_name: clientCase.case_name || "",
    court_name: clientCase.court_name || "",
    plaintiff_petitioner: clientCase.plaintiff_petitioner || "",
    defendant_respondent: clientCase.defendant_respondent || "",
    notes: clientCase.notes || "",
    status: clientCase.status || "active",
    home_address: clientCase.home_address || "",
    work_address: clientCase.work_address || "",
    documents_to_serve: clientCase.documents_to_serve || "",
    assigned_to: clientCase.assigned_to || "",
    assigned_name: clientCase.assigned_name || "",
    service_requirements: clientCase.service_requirements || "",
    contact_info: clientCase.contact_info || "",
  });

  const [assignmentChanged, setAssignmentChanged] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Reset form to current case values when opening
      setCaseData({
        case_number: clientCase.case_number || "",
        case_name: clientCase.case_name || "",
        court_name: clientCase.court_name || "",
        plaintiff_petitioner: clientCase.plaintiff_petitioner || "",
        defendant_respondent: clientCase.defendant_respondent || "",
        notes: clientCase.notes || "",
        status: clientCase.status || "active",
        home_address: clientCase.home_address || "",
        work_address: clientCase.work_address || "",
        documents_to_serve: clientCase.documents_to_serve || "",
        assigned_to: clientCase.assigned_to || "",
        assigned_name: clientCase.assigned_name || "",
        service_requirements: clientCase.service_requirements || "",
        contact_info: clientCase.contact_info || "",
      });
      setAssignmentChanged(false);

      const caseId = clientCase.$id || (clientCase as any).id;
      if (caseId) {
        api.getRecipients(caseId)
          .then((recs) => {
            if (Array.isArray(recs) && recs.length > 0) {
              setRecipients(recs.map((r: any) => ({
                id: r.id || r.$id,
                full_name: r.full_name || r.fullName || "",
                role: r.role || "Defendant / Respondent",
              })));
            } else {
              setRecipients([
                { full_name: clientCase.case_name || clientCase.defendant_respondent || "", role: "Defendant / Respondent" }
              ]);
            }
          })
          .catch(() => {
            setRecipients([
              { full_name: clientCase.case_name || clientCase.defendant_respondent || "", role: "Defendant / Respondent" }
            ]);
          });
      }

      api.getUsers()
        .then((users) => {
          if (Array.isArray(users)) {
            setAvailableServers(users.filter((u) => u.isActive !== false));
          }
        })
        .catch(() => {});
    }
  }, [isOpen, clientCase]);

  const handleSave = async () => {
    try {
      const validRecipients = recipients
        .map((r) => ({ ...r, full_name: r.full_name.trim() }))
        .filter((r) => Boolean(r.full_name));

      const primaryRecipient = validRecipients[0]?.full_name || caseData.case_name || "";
      const combinedDefendants = validRecipients.length > 1
        ? validRecipients.map((r) => r.full_name).join(" & ")
        : (caseData.defendant_respondent || primaryRecipient);

      const payload: Record<string, unknown> = {
        id: clientCase.$id,
        case_number: caseData.case_number,
        case_name: primaryRecipient,
        court_name: caseData.court_name,
        plaintiff_petitioner: caseData.plaintiff_petitioner,
        defendant_respondent: combinedDefendants,
        recipients: validRecipients,
        notes: caseData.notes,
        status: caseData.status,
        home_address: caseData.home_address,
        work_address: caseData.work_address,
        documents_to_serve: caseData.documents_to_serve,
        service_requirements: caseData.service_requirements,
        contact_info: caseData.contact_info,
      };
      // Only send assignment fields if user explicitly changed them
      if (assignmentChanged) {
        payload.assigned_to = caseData.assigned_to;
        payload.assigned_name = caseData.assigned_name;
      }
      await onUpdate(payload);
      setIsOpen(false);
    } catch (error) {
      console.error("Error updating case:", error);
    }
  };

  const handleServerChange = (userId: string) => {
    setAssignmentChanged(true);
    if (!userId || userId === "unassigned") {
      setCaseData((prev) => ({ ...prev, assigned_to: "", assigned_name: "" }));
      return;
    }
    const found = availableServers.find((u) => u.id === userId);
    setCaseData((prev) => ({
      ...prev,
      assigned_to: userId,
      assigned_name: found ? found.displayName : "",
    }));
  };

  const addRecipient = () => {
    setRecipients((prev) => [...prev, { full_name: "", role: "Defendant / Respondent" }]);
  };

  const updateRecipient = (index: number, field: keyof RecipientEntry, value: string) => {
    setRecipients((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const removeRecipient = (index: number) => {
    setRecipients((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
        className={className || "h-10 px-3"}
      >
        <Edit className="h-3.5 w-3.5 mr-1 shrink-0" />
        Edit
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Case {caseData.case_number}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="case_number">Case Number</Label>
              <Input
                id="case_number"
                value={caseData.case_number}
                onChange={(e) => setCaseData((prev) => ({ ...prev, case_number: e.target.value }))}
                placeholder="Enter case number"
              />
            </div>

            <div>
              <Label htmlFor="assigned_server">Assign Field Process Server</Label>
              <Select
                value={caseData.assigned_to || "unassigned"}
                onValueChange={handleServerChange}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Unassigned (Admin only)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned (Admin only)</SelectItem>
                  {availableServers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.displayName} (@{s.username}) {s.role === "server" ? "— Field Server" : "— Admin"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">
                When assigned, this case appears directly on that server's device. Client contact info is hidden from them.
              </p>
            </div>

            {/* Person(s) Being Served Section */}
            <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex justify-between items-center">
                <Label className="font-semibold text-xs flex items-center gap-1.5 text-slate-900 dark:text-slate-100">
                  <Users className="w-4 h-4 text-blue-600" />
                  People Being Served at this Address ({recipients.length || 1})
                </Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs flex items-center gap-1 border-blue-200 text-blue-700 hover:bg-blue-50"
                  onClick={addRecipient}
                >
                  <Plus className="w-3 h-3" />
                  Add Person
                </Button>
              </div>

              {recipients.length === 0 ? (
                <div>
                  <Input
                    value={caseData.case_name}
                    onChange={(e) => {
                      const v = e.target.value;
                      setCaseData((prev) => ({ ...prev, case_name: v }));
                    }}
                    placeholder="Who are you serving? (full name)"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  {recipients.map((rec, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <div className="flex-1">
                        <Input
                          value={rec.full_name}
                          onChange={(e) => updateRecipient(idx, "full_name", e.target.value)}
                          placeholder={idx === 0 ? "Primary Person Being Served" : `Person #${idx + 1} (e.g. spouse, co-defendant)`}
                          className="h-9 text-xs"
                        />
                      </div>
                      {recipients.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-9 w-9 p-0 text-red-500 hover:text-red-700 hover:bg-red-50 shrink-0"
                          onClick={() => removeRecipient(idx)}
                          title="Remove recipient"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                Multiple people at the same address will each get their own separate selectable Affidavit upon completion or non-service.
              </p>
            </div>

            <div>
              <Label htmlFor="court_name">Court Name (full caption)</Label>
              <Input
                id="court_name"
                value={caseData.court_name}
                onChange={(e) => setCaseData((prev) => ({ ...prev, court_name: e.target.value }))}
                placeholder="IN THE DISTRICT COURT IN AND FOR TULSA COUNTY STATE OF OKLAHOMA"
              />
            </div>
            <div>
              <Label htmlFor="plaintiff_petitioner">Plaintiff/Petitioner</Label>
              <Input
                id="plaintiff_petitioner"
                value={caseData.plaintiff_petitioner}
                onChange={(e) => setCaseData((prev) => ({ ...prev, plaintiff_petitioner: e.target.value }))}
                placeholder="Enter plaintiff/petitioner"
              />
            </div>
            <div>
              <Label htmlFor="defendant_respondent">Defendant/Respondent (caption)</Label>
              <Input
                id="defendant_respondent"
                value={caseData.defendant_respondent}
                onChange={(e) => setCaseData((prev) => ({ ...prev, defendant_respondent: e.target.value }))}
                placeholder="Usually same as Person Being Served"
              />
            </div>
            <div>
              <Label htmlFor="documents_to_serve">Documents to Serve</Label>
              <Textarea
                id="documents_to_serve"
                value={caseData.documents_to_serve}
                onChange={(e) => setCaseData((prev) => ({ ...prev, documents_to_serve: e.target.value }))}
                placeholder="Exact titles from cover sheet (Summons, Petition, …)"
                className="min-h-[80px]"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Printed on the affidavit Documents line. Keep titles exact.
              </p>
            </div>
            <div>
              <Label htmlFor="home_address">Home Address</Label>
              <Input
                id="home_address"
                value={caseData.home_address}
                onChange={(e) => setCaseData((prev) => ({ ...prev, home_address: e.target.value }))}
                placeholder="Primary service address"
              />
            </div>
            <div>
              <Label htmlFor="work_address">Secondary Address</Label>
              <Input
                id="work_address"
                value={caseData.work_address}
                onChange={(e) => setCaseData((prev) => ({ ...prev, work_address: e.target.value }))}
                placeholder="Work, alternate, or 2nd location"
              />
            </div>
            <div>
              <Label htmlFor="status">Case Status</Label>
              <Select 
                value={caseData.status} 
                onValueChange={(value) => setCaseData((prev) => ({ ...prev, status: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="served">Served</SelectItem>
                  <SelectItem value="non-service">Non-Service</SelectItem>
                  <SelectItem value="on-hold">On Hold</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="service_requirements">Case Requirements</Label>
              <Textarea
                id="service_requirements"
                value={caseData.service_requirements}
                onChange={(e) => setCaseData((prev) => ({ ...prev, service_requirements: e.target.value }))}
                placeholder="Personal only, 3 attempts, posting authorized, gated community, etc."
              />
            </div>
            <div>
              <Label htmlFor="contact_info">Possible Phone / Contact</Label>
              <Textarea
                id="contact_info"
                value={caseData.contact_info}
                onChange={(e) => setCaseData((prev) => ({ ...prev, contact_info: e.target.value }))}
                placeholder="Known numbers, roommate, employer, gate, neighbor"
              />
            </div>
            <div>
              <Label htmlFor="notes">Notes & Special Instructions</Label>
              <Textarea
                id="notes"
                value={caseData.notes}
                onChange={(e) => setCaseData((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="Gate codes, vehicle details, service notes"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isLoading}>
                {isLoading ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

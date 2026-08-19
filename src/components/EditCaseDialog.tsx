import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Edit, UserCheck } from "lucide-react";
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
}

interface UserOption {
  id: string;
  username: string;
  displayName: string;
  role: string;
}

export default function EditCaseDialog({ clientCase, onUpdate, isLoading }: EditCaseDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [availableServers, setAvailableServers] = useState<UserOption[]>([]);
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
      api.getUsers()
        .then((users) => {
          if (Array.isArray(users)) {
            setAvailableServers(users.filter((u) => u.role === "server"));
          }
        })
        .catch(() => {});
    }
  }, [isOpen, clientCase]);

  const handleSave = async () => {
    try {
      const payload: Record<string, unknown> = {
        id: clientCase.$id,
        case_number: caseData.case_number,
        case_name: caseData.case_name,
        court_name: caseData.court_name,
        plaintiff_petitioner: caseData.plaintiff_petitioner,
        defendant_respondent: caseData.defendant_respondent,
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

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
        className="h-10 px-3"
      >
        <Edit className="h-4 w-4 mr-1" />
        Edit
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Case</DialogTitle>
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
              <Label htmlFor="assigned_server" className="flex items-center gap-1">
                <UserCheck className="h-4 w-4 text-primary" /> Assign Field Process Server
              </Label>
              <Select
                value={caseData.assigned_to || "unassigned"}
                onValueChange={handleServerChange}
              >
                <SelectTrigger id="assigned_server" className="w-full mt-1">
                  <SelectValue placeholder="Select server to assign" />
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

            <div>
              <Label htmlFor="case_name">Person Being Served</Label>
              <Input
                id="case_name"
                value={caseData.case_name}
                onChange={(e) => {
                  const v = e.target.value;
                  setCaseData((prev) => ({
                    ...prev,
                    case_name: v,
                    defendant_respondent:
                      !prev.defendant_respondent || prev.defendant_respondent === prev.case_name
                        ? v
                        : prev.defendant_respondent,
                  }));
                }}
                placeholder="Who are you serving? (full name)"
              />
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
                  <SelectItem value="pending">Pending</SelectItem>
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

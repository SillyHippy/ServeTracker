import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, ArrowLeft, ArrowRight, Check } from "lucide-react";
import { api } from "@/lib/api";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

interface IntakeForm {
  legalName: string;
  displayName: string;
  email: string;
  phone: string;
  licenseNumber: string;
  licenseJurisdiction: string;
  licenseExpiresAt: string;
  serviceTerritory: string;
  username: string;
  temporaryPassword: string;
  profileNotes: string;
}

const EMPTY: IntakeForm = {
  legalName: "",
  displayName: "",
  email: "",
  phone: "",
  licenseNumber: "",
  licenseJurisdiction: "",
  licenseExpiresAt: "",
  serviceTerritory: "",
  username: "",
  temporaryPassword: "",
  profileNotes: "",
};

const STEPS = ["Identity", "Credentials", "Account"] as const;

export const ServerIntakeDialog: React.FC<Props> = ({ open, onOpenChange, onCreated }) => {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<IntakeForm>(EMPTY);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const set = (k: keyof IntakeForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const reset = () => { setForm(EMPTY); setStep(0); };

  const canNext = () => {
    if (step === 0) return form.legalName.trim() && form.displayName.trim();
    if (step === 1) return form.licenseNumber.trim() && form.licenseJurisdiction.trim() && form.licenseExpiresAt.trim();
    return form.username.trim() && form.temporaryPassword.length >= 8;
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const territory = form.serviceTerritory.split(",").map((s) => s.trim()).filter(Boolean);
      const res = await api.createUser({
        username: form.username.trim().toLowerCase().replace(/\s+/g, ""),
        password: form.temporaryPassword,
        displayName: form.displayName.trim(),
        legalName: form.legalName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        licenseNumber: form.licenseNumber.trim(),
        licenseJurisdiction: form.licenseJurisdiction.trim(),
        licenseExpiresAt: form.licenseExpiresAt,
        serviceTerritory: territory,
        profileNotes: form.profileNotes.trim() || undefined,
      });
      if (res.success) {
        const loginName = form.username.trim().toLowerCase().replace(/\s+/g, "");
        toast({
          title: "Field server created",
          description: `Login username: ${loginName}. They must sign in with the temporary password and set a new one.`,
        });
        reset();
        onCreated();
        onOpenChange(false);
      }
    } catch (err) {
      toast({
        title: "Creation failed",
        description: err instanceof Error ? err.message : "Could not create server account",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-blue-600" />
            Add Field Server
          </DialogTitle>
          <DialogDescription>
            Step {step + 1} of {STEPS.length}: {STEPS[step]}. The new account starts Pending setup and
            must set its own password on first login.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleCreate}>
          <div className="space-y-4 py-4">
            {step === 0 && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="in-legal">Legal / Process-Server Name *</Label>
                  <Input id="in-legal" placeholder="Name as it appears on the license"
                    value={form.legalName} onChange={(e) => set("legalName", e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="in-display">Display Name *</Label>
                  <Input id="in-display" placeholder="Name shown in the app"
                    value={form.displayName} onChange={(e) => set("displayName", e.target.value)} required />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="in-email">Email</Label>
                    <Input id="in-email" type="email" placeholder="server@example.com"
                      value={form.email} onChange={(e) => set("email", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="in-phone">Mobile</Label>
                    <Input id="in-phone" type="tel" placeholder="(555) 123-4567"
                      value={form.phone} onChange={(e) => set("phone", e.target.value)} />
                  </div>
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="in-lic">Process-Server License / Credential # *</Label>
                  <Input id="in-lic" placeholder="e.g. PSL-2026-42"
                    value={form.licenseNumber} onChange={(e) => set("licenseNumber", e.target.value)} required />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="in-jur">Issuing Jurisdiction *</Label>
                    <Input id="in-jur" placeholder="e.g. OK" maxLength={2}
                      value={form.licenseJurisdiction} onChange={(e) => set("licenseJurisdiction", e.target.value.toUpperCase())} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="in-exp">License Expiration *</Label>
                    <Input id="in-exp" type="date"
                      value={form.licenseExpiresAt} onChange={(e) => set("licenseExpiresAt", e.target.value)} required />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="in-territory">Service Territory / Counties</Label>
                  <Input id="in-territory" placeholder="Comma-separated, e.g. Tulsa, Wagoner, Rogers"
                    value={form.serviceTerritory} onChange={(e) => set("serviceTerritory", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="in-notes">Internal Admin Notes</Label>
                  <Textarea id="in-notes" placeholder="Visible to administrators only"
                    value={form.profileNotes} onChange={(e) => set("profileNotes", e.target.value)} rows={2} />
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="in-user">Username *</Label>
                  <Input id="in-user" placeholder="e.g. sarah"
                    value={form.username}
                    onChange={(e) => set("username", e.target.value.toLowerCase().replace(/\s+/g, ""))} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="in-temp">Temporary Password * (min 8 chars)</Label>
                  <Input id="in-temp" type="password" placeholder="Server must change this on first login"
                    value={form.temporaryPassword} onChange={(e) => set("temporaryPassword", e.target.value)} required />
                </div>
                <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 space-y-1">
                  <div><strong>Legal name:</strong> {form.legalName || "—"}</div>
                  <div><strong>Display name:</strong> {form.displayName || "—"}</div>
                  <div><strong>License:</strong> {form.licenseNumber || "—"} ({form.licenseJurisdiction || "—"}, expires {form.licenseExpiresAt || "—"})</div>
                  <div><strong>Territory:</strong> {form.serviceTerritory || "—"}</div>
                  <div className="pt-1 text-slate-500">
                    Field servers only see cases assigned to them and cannot view client contact info.
                  </div>
                </div>
              </>
            )}
          </div>

          <DialogFooter className="gap-2">
            {step > 0 && (
              <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button type="button" onClick={() => setStep(step + 1)} disabled={!canNext()}>
                Next <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button type="submit" disabled={isSaving || !canNext()}>
                  {isSaving ? "Creating..." : <><Check className="h-4 w-4 mr-1" /> Create Account</>}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ServerIntakeDialog;

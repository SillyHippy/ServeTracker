import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { PenLine, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import SignatureCapture from "@/components/SignatureCapture";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful enroll/replace or delete. */
  onChanged: () => void;
  /** Existing enrollment (for replace) */
  existing?: { enrolled: boolean; updatedAt?: string };
}

const CONSENT_TEXT =
  "This is my signature. I authorize its use only through my authenticated ServeTracker account on affidavits assigned to me.";

export const SignatureEnrollmentDialog: React.FC<Props> = ({ open, onOpenChange, onChanged, existing }) => {
  const [imageData, setImageData] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const reset = () => {
    setImageData(null);
    setPassword("");
    setConsent(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageData) {
      toast({ title: "Signature required", description: "Draw or upload your signature first", variant: "destructive" });
      return;
    }
    if (!password) {
      toast({ title: "Password required", description: "Re-enter your current password to confirm", variant: "destructive" });
      return;
    }
    if (!consent) {
      toast({ title: "Consent required", description: "You must confirm this is your signature", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      const mimeType = imageData.startsWith("data:image/jpeg") ? "image/jpeg"
        : imageData.startsWith("data:image/webp") ? "image/webp" : "image/png";
      const res = await api.enrollSignature({
        password,
        image_data: imageData,
        mime_type: mimeType,
        ack: consent,
      });
      if (res.success) {
        toast({
          title: existing?.enrolled ? "Signature replaced" : "Signature enrolled",
          description: "Your signature is stored securely and will be applied only to affidavits assigned to you.",
        });
        reset();
        onChanged();
        onOpenChange(false);
      }
    } catch (err) {
      toast({
        title: "Enrollment failed",
        description: err instanceof Error ? err.message : "Could not save signature",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!password) {
      toast({ title: "Password required", description: "Re-enter your current password to remove your signature", variant: "destructive" });
      return;
    }
    if (!confirm("Remove your saved signature? Signed affidavits for your cases will stop rendering until you enroll again.")) return;
    setIsSaving(true);
    try {
      await api.deleteMySignature(password);
      toast({ title: "Signature removed", description: "Your saved signature has been revoked." });
      reset();
      onChanged();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Remove failed",
        description: err instanceof Error ? err.message : "Could not remove signature",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSave}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenLine className="h-5 w-5 text-blue-600" />
              {existing?.enrolled ? "Replace My Signature" : "Enroll My Signature"}
            </DialogTitle>
            <DialogDescription>
              {existing?.enrolled
                ? "Your current signature will be revoked and replaced with the new mark."
                : "Draw your signature below or upload an image. Only you can enroll or replace your own signature."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <SignatureCapture value={imageData} onChange={setImageData} />

            <div className="space-y-2">
              <Label htmlFor="sig-password">Current Password</Label>
              <Input
                id="sig-password"
                type="password"
                placeholder="Confirm with your current password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            <label className="flex items-start gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 cursor-pointer">
              <Checkbox
                checked={consent}
                onCheckedChange={(v) => setConsent(v === true)}
                className="mt-0.5"
              />
              <span>{CONSENT_TEXT}</span>
            </label>

            {existing?.enrolled && (
              <div className="text-xs text-slate-500">
                This applies the process server's electronic signature only. It does not notarize the affidavit.
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            {existing?.enrolled && (
              <Button type="button" variant="ghost" className="text-red-600 hover:text-red-700 hover:bg-red-50 mr-auto"
                onClick={handleDelete} disabled={isSaving}>
                <Trash2 className="h-4 w-4 mr-1" /> Remove
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSaving || !imageData || !consent}>
              {isSaving ? "Saving..." : existing?.enrolled ? "Replace Signature" : "Save Signature"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default SignatureEnrollmentDialog;

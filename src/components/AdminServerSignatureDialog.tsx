import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { API_BASE } from "@/lib/api";
import { PenLine, Upload, CheckCircle2 } from "lucide-react";
import SignatureCapture from "@/components/SignatureCapture";

interface Props {
  userId: string;
  serverName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

export const AdminServerSignatureDialog: React.FC<Props> = ({
  userId,
  serverName,
  open,
  onOpenChange,
  onChanged,
}) => {
  const [imageData, setImageData] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const reset = () => {
    setImageData(null);
    setAuthorized(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageData) {
      toast({
        title: "Signature required",
        description: "Please draw or upload a signature image first",
        variant: "destructive",
      });
      return;
    }
    if (!authorized) {
      toast({
        title: "Authorization required",
        description: "Please check the box confirming server authorization",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const mimeType = imageData.startsWith("data:image/jpeg")
        ? "image/jpeg"
        : imageData.startsWith("data:image/webp")
        ? "image/webp"
        : "image/png";

      const res = await fetch(`${API_BASE}/api/users/${userId}/signature`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          signatureData: imageData,
          mimeType,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to enroll signature");
      }

      toast({
        title: "Signature Enrolled ✍️",
        description: `${serverName}'s e-signature is now active and ready for 1-click affidavit generation.`,
      });
      reset();
      onChanged();
      onOpenChange(false);
    } catch (err: any) {
      toast({
        title: "Could not enroll signature",
        description: err.message || "Upload failed",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base text-slate-900">
            <PenLine className="h-5 w-5 text-blue-600" />
            Upload / Enroll Signature for {serverName}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            As administrator, you can enroll a signature on file for this process server (e.g. from an onboarding form or authorized waiver).
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4 pt-2">
          <div>
            <SignatureCapture
              value={imageData}
              onChange={(data) => setImageData(data)}
              baselineLabel="Sign or upload above"
            />
          </div>

          <div className="flex items-start gap-2.5 p-3 bg-blue-50/60 border border-blue-200 rounded-lg text-xs">
            <Checkbox
              id="admin-sig-auth"
              checked={authorized}
              onCheckedChange={(c) => setAuthorized(!!c)}
              className="mt-0.5"
            />
            <label htmlFor="admin-sig-auth" className="text-blue-950 font-medium cursor-pointer leading-relaxed">
              I confirm that {serverName} has granted authorization for Just Legal Solutions to place this electronic signature on file for legal court affidavits.
            </label>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isSaving || !imageData || !authorized}
              className="bg-blue-600 hover:bg-blue-700 font-semibold"
            >
              {isSaving ? "Saving..." : "Save Server Signature"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, AlertCircle, FileText, User, MapPin, Loader2, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/use-toast";

export interface ReserviceJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseItem: {
    id: string;
    case_number?: string;
    case_name?: string;
    defendant_respondent?: string;
    plaintiff_petitioner?: string;
    home_address?: string;
    work_address?: string;
    documents_to_serve?: string;
    client_id?: string;
    client_name?: string;
    status?: string;
    [key: string]: any;
  } | null;
  onSuccess?: (newCase: any) => void;
}

export function ReserviceJobDialog({
  open,
  onOpenChange,
  caseItem,
  onSuccess,
}: ReserviceJobDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  if (!caseItem) return null;

  const caseId = caseItem.id || caseItem.$id;
  const caseNumber = caseItem.case_number || caseItem.caseNumber || "No Case #";
  const person = caseItem.defendant_respondent || caseItem.case_name || caseItem.personBeingServed || "Recipient";
  const address = caseItem.home_address || caseItem.work_address || "No address provided";
  const docs = caseItem.documents_to_serve || caseItem.documentsToServe || "Standard Service Documents";

  const handleReservice = async () => {
    setIsSubmitting(true);
    try {
      const res = await api.duplicateJobForReservice(caseId);
      toast({
        title: "Re-service Job Created",
        description: `New active job created for ${caseNumber}. Original served job remains untouched.`,
        variant: "default",
      });
      onOpenChange(false);
      if (onSuccess) onSuccess(res);
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err || "");
      const isPendingBackend =
        err?.status === 404 ||
        err?.status === 501 ||
        /404|501|not found|not implemented/i.test(msg);

      if (isPendingBackend) {
        toast({
          title: "Feature Pending Server Deployment",
          description: "The backend re-service endpoint (/api/cases/:id/reservice) is pending server deployment. The original job and affidavit were NOT modified.",
          variant: "default",
        });
      } else {
        toast({
          title: "Could not create re-service job",
          description: msg.slice(0, 240),
          variant: "destructive",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-5 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Copy className="h-5 w-5 text-indigo-600" />
            <span>Re-service / Duplicate Job</span>
          </DialogTitle>
          <DialogDescription>
            This case is marked as <strong>Served</strong>. Re-servicing creates a separate job with a clean attempt history, preserving the original served record and its signed affidavit.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 text-sm">
          <div className="bg-slate-50 dark:bg-slate-900 border rounded-lg p-3 space-y-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Target Case Details
            </div>
            <div className="flex items-center gap-2 text-foreground font-medium">
              <FileText className="h-4 w-4 text-indigo-600 shrink-0" />
              <span>{caseNumber}</span>
            </div>
            <div className="flex items-center gap-2 text-foreground text-xs">
              <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span>{person}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate">{address}</span>
            </div>
          </div>

          <div className="bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 rounded-lg p-3 text-xs text-indigo-900 dark:text-indigo-200 space-y-1.5">
            <div className="font-semibold flex items-center gap-1.5 text-indigo-700 dark:text-indigo-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Preserves Audit Integrity</span>
            </div>
            <ul className="list-disc pl-4 space-y-1 text-indigo-800 dark:text-indigo-300">
              <li>New job receives fresh UUID with status <strong>Active</strong>.</li>
              <li>Attempt history starts at 0 attempts.</li>
              <li>Original served job and signed court affidavit remain unchanged.</li>
            </ul>
          </div>
        </div>

        <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="h-10"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleReservice}
            disabled={isSubmitting}
            className="h-10 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center gap-1.5"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Duplicating...</span>
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                <span>Create Re-service Job</span>
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

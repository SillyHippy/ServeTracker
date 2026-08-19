import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ClipboardList, Printer, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { generateFieldSheetHtml, printFieldSheetInPage, type FieldSheetPayload } from "@/utils/fieldSheetEngine";
import { api } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function FieldSheetButton({
  data,
  className,
  size = "sm",
  label = "View Field Sheet",
}: {
  data: FieldSheetPayload & { caseId?: string; clientId?: string };
  className?: string;
  size?: "sm" | "default";
  label?: string;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [resolvedData, setResolvedData] = useState<FieldSheetPayload>(data);

  // Keep static prop in sync when dialog is closed or props change
  useEffect(() => {
    setResolvedData(data);
  }, [data]);

  // When opened, fetch live case data from backend to ensure documents_to_serve,
  // requirements, contact_info, addresses, and notes are never empty/stale.
  useEffect(() => {
    if (!open) return;
    const lookupKey = data.caseId || data.caseNumber;
    if (!lookupKey) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await api.getAffidavitData(lookupKey, data.clientId);
        if (cancelled || !res?.case) return;
        const c = res.case as Record<string, any>;
        setResolvedData((prev) => ({
          ...prev,
          caseNumber: c.case_number || prev.caseNumber,
          caseName: c.case_name || prev.caseName,
          courtName: c.court_name || prev.courtName,
          plaintiff: c.plaintiff_petitioner || prev.plaintiff,
          defendant: c.defendant_respondent || prev.defendant,
          documents: c.documents_to_serve || c.documentsToServe || prev.documents,
          requirements: c.service_requirements || c.requirements || prev.requirements,
          contactInfo: c.contact_info || c.contactInfo || prev.contactInfo,
          homeAddress: c.home_address || prev.homeAddress,
          workAddress: c.work_address || prev.workAddress,
          notes: c.notes || prev.notes,
          assignedServer: res.assignedServer || prev.assignedServer,
        }));
      } catch (err) {
        console.warn("FieldSheetButton: failed to fetch live case data, using props", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, data.caseId, data.caseNumber, data.clientId]);

  const html = useMemo(() => generateFieldSheetHtml(resolvedData), [resolvedData]);

  const handlePrint = () => {
    const ok = printFieldSheetInPage(html);
    if (!ok) {
      toast({
        title: "Could not print",
        description: "Try View Field Sheet again, then Print.",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Button type="button" variant="outline" size={size} className={className} onClick={() => setOpen(true)}>
        <ClipboardList className="h-4 w-4 mr-1" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[96vw] sm:max-w-3xl h-[92vh] p-0 overflow-hidden flex flex-col gap-0">
          <DialogHeader className="px-4 pt-4 pb-2 shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4" />
              Field Sheet{resolvedData.caseNumber ? ` · ${resolvedData.caseNumber}` : ""}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Same sheet for everyone. Read it here. Print uses this page — no extra window.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 px-4 pb-2 shrink-0">
            <Button type="button" size={size} onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-1" />
              Print
            </Button>
            <Button type="button" size={size} variant="ghost" onClick={() => setOpen(false)}>
              <X className="h-4 w-4 mr-1" />
              Close
            </Button>
          </div>
          <iframe
            title={`Field sheet ${resolvedData.caseNumber || ""}`}
            className="flex-1 w-full border-t bg-white min-h-0"
            srcDoc={html}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

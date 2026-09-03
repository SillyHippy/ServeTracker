import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { AffidavitPrepareResult } from "@/types/AffidavitExecution";
import { useAuth } from "@/context/AuthContext";
import { PenLine, Loader2, AlertTriangle } from "lucide-react";
import type { AffidavitKind } from "@/utils/affidavitEngine";
import { detectNotaryVenue, venueLabel, type NotaryVenue } from "@/utils/oklahomaVenue";

interface Props {
  caseId: string;
  caseNumber: string;
  personBeingServed: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful sign so the caller can render the signed version. */
  onSigned: (renderedHtml: string) => void;
  affidavitKind?: AffidavitKind;
  recipientId?: string;
  allRecipients?: Array<{ id: string; full_name: string }>;
}

export const AffidavitSignatureDialog: React.FC<Props> = ({
  caseId,
  caseNumber,
  personBeingServed,
  open,
  onOpenChange,
  onSigned,
  affidavitKind,
  recipientId,
  allRecipients,
}) => {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [prep, setPrep] = useState<AffidavitPrepareResult | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [isSigning, setIsSigning] = useState(false);
  const [signAllRecipients, setSignAllRecipients] = useState(true);
  const [venue, setVenue] = useState<NotaryVenue | null>(null);
  const [venueLoading, setVenueLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPrep(null);
    setConfirmation("");
    setVenue(null);
    setIsPreparing(true);
    setVenueLoading(true);
    (async () => {
      try {
        const res = await api.prepareAffidavit(caseId, affidavitKind, recipientId);
        setPrep(res);
      } catch (err) {
        toast({
          title: "Cannot prepare affidavit",
          description: err instanceof Error ? err.message : "Could not prepare",
          variant: "destructive",
        });
      } finally {
        setIsPreparing(false);
      }
    })();
    (async () => {
      try {
        const detected = await detectNotaryVenue({
          fallbackTexts: [caseNumber, personBeingServed],
        });
        setVenue(detected);
      } catch {
        setVenue({ state: "OKLAHOMA", county: "TULSA", source: "default" });
      } finally {
        setVenueLoading(false);
      }
    })();
  }, [open, caseId, affidavitKind, recipientId]);

  const handleSign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prep?.assignedServer) return;
    setIsSigning(true);
    try {
      const payload: Record<string, unknown> = {
        affidavitKind,
        recipientId,
        acknowledged: true,
        ack: true,
      };
      if (isAdmin) {
        payload.confirmation = confirmation.trim() || prep.assignedServer.displayName;
      }
      if (venue?.state) payload.notaryState = venue.state;
      if (venue?.county) payload.notaryCounty = venue.county;

      if (signAllRecipients && allRecipients && allRecipients.length > 1) {
        for (const r of allRecipients) {
          const p = { ...payload, recipientId: r.id };
          await api.signAffidavit(caseId, p as any);
        }
        toast({
          title: "All Affidavits Signed",
          description: `Applied ${prep.assignedServer.displayName}'s saved signature to all ${allRecipients.length} recipients.`,
        });
      } else {
        const res = await api.signAffidavit(caseId, payload as any);
        if (res.success) {
          toast({
            title: "Affidavit signed",
            description: isAdmin
              ? `Applied ${prep.assignedServer.displayName}'s saved signature on their behalf (notarization pending).`
              : "Your signature was applied. Status: Signed — notarization pending.",
          });
        }
      }
      const rendered = await api.renderAffidavit(caseId, recipientId);
      onSigned(rendered.html);
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Signing failed",
        description: err instanceof Error ? err.message : "Could not sign affidavit",
        variant: "destructive",
      });
    } finally {
      setIsSigning(false);
    }
  };

  const assignedName = prep?.assignedServer?.legalName || prep?.assignedServer?.displayName || "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PenLine className="h-5 w-5 text-blue-600" />
            Sign Affidavit
          </DialogTitle>
          <DialogDescription>
            Review the affidavit facts, then apply the assigned process server's electronic signature.
            You are already signed in — no password re-entry.
          </DialogDescription>
        </DialogHeader>

        {isPreparing ? (
          <div className="py-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Validating affidavit facts…
          </div>
        ) : !prep ? (
          <div className="py-8 text-center text-sm text-slate-500">Unable to prepare this affidavit.</div>
        ) : !prep.ready ? (
          <div className="py-8 text-center text-sm text-red-600 flex flex-col items-center gap-2">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
            <div>{prep.error || "Affidavit is not ready to sign."}</div>
          </div>
        ) : (
          <form onSubmit={handleSign}>
            <div className="space-y-3 py-2 text-sm">
              <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1.5">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 font-medium">Document:</span>
                  <span className="font-bold text-right">{prep.preview?.title}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 font-medium">Case No:</span>
                  <span className="font-semibold">{prep.preview?.caseNumber || caseNumber}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 font-medium">Person served:</span>
                  <span className="font-semibold text-right">{prep.preview?.personServed || personBeingServed}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 font-medium">Documents:</span>
                  <span className="font-semibold text-right">{prep.preview?.documents || "—"}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 font-medium">Attempts:</span>
                  <span className="font-semibold">{prep.preview?.attemptsCount}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 font-medium">Notary venue:</span>
                  <span className="font-semibold text-right">
                    {venueLoading ? "Detecting current county…" : venue ? venueLabel(venue) : "STATE OF OKLAHOMA / COUNTY OF TULSA"}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 font-medium">Method:</span>
                  <span className={`font-semibold text-right ${prep.preview?.methodRecorded ? "" : "text-amber-600"}`}>
                    {prep.preview?.kind === "non-service"
                      ? "N/A (Non-Service)"
                      : prep.preview?.methodRecorded
                      ? `${prep.preview?.method || "—"}${prep.preview?.acceptedBy ? ` — accepted by ${prep.preview.acceptedBy}` : ""}`
                      : "⚠ METHOD NOT RECORDED — verify before signing"}
                  </span>
                </div>
                <div className="flex justify-between gap-2 pt-1 border-t border-slate-200 dark:border-slate-700">
                  <span className="text-slate-500 font-medium">Assigned server:</span>
                  <span className="font-semibold text-right">
                    {assignedName}
                    {prep.assignedServer?.licenseNumber ? ` (${prep.assignedServer.licenseNumber})` : ""}
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                <strong>Notice:</strong> This applies the process server's electronic signature only. It does
                not notarize the affidavit. The notary block remains for wet-ink / stamp by the real notary.
              </div>

              {allRecipients && allRecipients.length > 1 && (
                <div className="flex items-center space-x-2 p-2.5 bg-blue-50/70 dark:bg-blue-950/40 rounded-lg border border-blue-200 dark:border-blue-800">
                  <input
                    type="checkbox"
                    id="sign-all-recipients"
                    checked={signAllRecipients}
                    onChange={(e) => setSignAllRecipients(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor="sign-all-recipients" className="text-xs font-semibold text-blue-900 dark:text-blue-200 cursor-pointer">
                    Apply signature to all {allRecipients.length} recipients on this case ({allRecipients.map(r => r.full_name).join(", ")})
                  </label>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                type="submit"
                disabled={isSigning}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {isSigning ? "Applying…" : `Apply Signature (${assignedName})`}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default AffidavitSignatureDialog;

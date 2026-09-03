import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { CheckCircle2, Loader2 } from "lucide-react";

interface MarkPaidDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseItem: {
    id: string;
    case_number?: string;
    case_name?: string;
    defendant_respondent?: string;
    quoted_fee?: string | number;
    payment_status?: string;
    payment_method?: string;
    payment_notes?: string;
  } | null;
  onSuccess?: () => void;
}

export default function MarkPaidDialog({
  open,
  onOpenChange,
  caseItem,
  onSuccess,
}: MarkPaidDialogProps) {
  const { toast } = useToast();
  const [paymentMethod, setPaymentMethod] = useState("check");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paidAtDate, setPaidAtDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [saving, setSaving] = useState(false);

  if (!caseItem) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.markCasePaid(caseItem.id, {
        payment_method: paymentMethod,
        payment_notes: paymentNotes.trim(),
        paid_at: new Date(paidAtDate).toISOString(),
      });
      toast({
        title: "Payment recorded",
        description: `Case #${caseItem.case_number || ""} marked as PAID (${paymentMethod}).`,
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Could not record payment",
        description: err instanceof Error ? err.message : "Request failed",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const isAlreadyPaid = caseItem.payment_status === "PAID";

  const handleRevertUnpaid = async () => {
    setSaving(true);
    try {
      await api.markCaseUnpaid(caseItem.id);
      toast({
        title: "Payment reverted",
        description: `Case #${caseItem.case_number || ""} set back to UNPAID.`,
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Could not revert payment",
        description: err instanceof Error ? err.message : "Request failed",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              {isAlreadyPaid ? "Update Payment Details" : "Record Payment (Manual Override)"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Case #{caseItem.case_number || "—"} ({caseItem.defendant_respondent || caseItem.case_name || "Target"})
              {caseItem.quoted_fee ? ` · Quoted Fee: $${Number(caseItem.quoted_fee).toFixed(2)}` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4 text-xs sm:text-sm">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select payment method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="check">Paper Check / Law Firm Check</SelectItem>
                  <SelectItem value="ach">Direct Bank ACH / Wire</SelectItem>
                  <SelectItem value="cash">Cash Received in Field</SelectItem>
                  <SelectItem value="zelle">Zelle / Venmo / CashApp</SelectItem>
                  <SelectItem value="helcim_online">Helcim Card (Online)</SelectItem>
                  <SelectItem value="waived">Fee Waived / Pro Bono / Courtesy</SelectItem>
                  <SelectItem value="other">Other Method</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="payment_notes" className="text-xs font-semibold">
                Check # / Transaction Reference / Notes
              </Label>
              <Input
                id="payment_notes"
                placeholder="e.g. Check #4109 from Conner & Winters"
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                className="h-9"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="paid_at" className="text-xs font-semibold">
                Date Payment Received
              </Label>
              <Input
                id="paid_at"
                type="date"
                value={paidAtDate}
                onChange={(e) => setPaidAtDate(e.target.value)}
                className="h-9"
              />
            </div>
          </div>

          <DialogFooter className="flex flex-row justify-between sm:justify-between items-center gap-2">
            {isAlreadyPaid ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-amber-700 hover:text-amber-800 border-amber-300 hover:bg-amber-50"
                onClick={handleRevertUnpaid}
                disabled={saving}
              >
                Revert to Unpaid
              </Button>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 font-semibold">
                {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Save Payment
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

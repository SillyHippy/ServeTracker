import React, { useState } from "react";
import { Send, AlertCircle, Clock, Phone, AlertTriangle, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { API_BASE } from "@/lib/api";

const PRESET_MESSAGES = [
  {
    label: "Attempt Needed Today",
    text: "Please make an attempt on this case today (morning/evening rush).",
    icon: Clock,
  },
  {
    label: "Hearing Approaching",
    text: "Court date is approaching. Please prioritize service on this subject.",
    icon: AlertCircle,
  },
  {
    label: "Call Office",
    text: "Please contact the office regarding updated intel on this subject.",
    icon: Phone,
  },
  {
    label: "Stop Service / On Hold",
    text: "DO NOT ATTEMPT: Service is on hold pending client review.",
    icon: AlertTriangle,
  },
];

export default function NudgeServerDialog({
  caseId,
  caseNumber,
  serverName,
  compact = false,
}: {
  caseId: string;
  caseNumber: string;
  serverName?: string;
  compact?: boolean;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(PRESET_MESSAGES[0].text);
  const [sending, setSending] = useState(false);

  const handleSendNudge = async () => {
    if (!message.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/cases/${caseId}/nudge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to send nudge");
      }
      toast({
        title: "Nudge Sent",
        description: `Direct alert dispatched to ${serverName || "assigned server"}.`,
      });
      setOpen(false);
    } catch (err: any) {
      toast({
        title: "Could not send nudge",
        description: err.message || "Network error",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {compact ? (
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 min-h-8 min-w-8 text-amber-700 bg-amber-50/50 border-amber-300 hover:bg-amber-100 rounded-full shrink-0 shadow-xs"
            title={`Nudge server (${serverName || "assigned"})`}
          >
            <Bell className="h-4 w-4 text-amber-600" />
            <span className="sr-only">Nudge</span>
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="min-h-10 h-10 text-amber-700 border-amber-300 hover:bg-amber-50">
            <Bell className="h-3.5 w-3.5 mr-1 text-amber-600" />
            Nudge Server
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Send className="h-4 w-4 text-amber-600" />
            Nudge Server {serverName ? `(${serverName})` : ""}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Sends an instant targeted push notification & in-app alert directly to this server for Case #{caseNumber}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <label className="text-xs font-bold text-slate-700 block">Quick Presets:</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {PRESET_MESSAGES.map((preset) => {
              const Icon = preset.icon;
              const isSelected = message === preset.text;
              return (
                <button
                  type="button"
                  key={preset.label}
                  onClick={() => setMessage(preset.text)}
                  className={`text-left p-2 rounded-md border text-xs font-semibold flex items-center gap-2 transition-colors ${
                    isSelected
                      ? "bg-amber-50 border-amber-500 text-amber-950"
                      : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                  <span>{preset.label}</span>
                </button>
              );
            })}
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">Message Preview:</label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className="text-xs"
              placeholder="Type a custom directive..."
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSendNudge}
            disabled={sending || !message.trim()}
            className="bg-amber-600 hover:bg-amber-500 text-white"
          >
            {sending ? "Sending..." : "Dispatch Direct Alert"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import React, { useState } from "react";
import { Send, AlertCircle, Clock, Phone, AlertTriangle, Bell, MessageSquare, Sparkles } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { API_BASE } from "@/lib/api";

const DIRECTIVE_PRESETS = [
  {
    label: "Urgent Serve Available",
    title: "Urgent Serve Available",
    text: "New priority papers are ready for pickup. Please check your dashboard or contact dispatch.",
    icon: Clock,
  },
  {
    label: "Call Dispatch",
    title: "Please Call Dispatch",
    text: "Please call the dispatch office regarding updated case intel and instructions.",
    icon: Phone,
  },
  {
    label: "Status Update Needed",
    title: "Status Update Needed",
    text: "Please log your latest field attempt and status on assigned active cases.",
    icon: AlertCircle,
  },
  {
    label: "Territory Coverage",
    title: "Territory Coverage Check",
    text: "Are you available for urgent rush service today in your coverage area?",
    icon: MessageSquare,
  },
];

export default function NotifyServerDialog({
  serverId,
  serverName,
  compact = false,
}: {
  serverId: string;
  serverName: string;
  compact?: boolean;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(DIRECTIVE_PRESETS[0].title);
  const [message, setMessage] = useState(DIRECTIVE_PRESETS[0].text);
  const [priority, setPriority] = useState<"normal" | "high" | "urgent">("high");
  const [sending, setSending] = useState(false);

  const handleSendDirective = async () => {
    if (!message.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/servers/${serverId}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: title.trim() || "Dispatch Directive",
          message: message.trim(),
          priority,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to dispatch directive");
      }

      toast({
        title: "Notification Dispatched 🔔",
        description: `Directive sent directly to ${serverName}'s phone and dashboard.`,
      });
      setOpen(false);
    } catch (err: any) {
      toast({
        title: "Could not send directive",
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
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-2.5 rounded-md text-xs font-semibold bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100 transition shadow-2xs inline-flex items-center gap-1"
          title={`Send notification to ${serverName}`}
        >
          <Bell className="h-3.5 w-3.5 text-amber-600" /> Notify
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base text-slate-900">
            <Bell className="h-5 w-5 text-amber-500" />
            Send Directive to {serverName}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            Dispatches an instant in-app notification and phone push alert directly to {serverName}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Presets */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700">Quick Directives</label>
            <div className="grid grid-cols-2 gap-1.5">
              {DIRECTIVE_PRESETS.map((preset, idx) => {
                const Icon = preset.icon;
                const isSelected = message === preset.text;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setTitle(preset.title);
                      setMessage(preset.text);
                    }}
                    className={`flex items-center gap-1.5 p-2 rounded border text-left text-xs transition ${
                      isSelected
                        ? "bg-amber-50 border-amber-300 text-amber-900 font-medium"
                        : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                    <span className="truncate">{preset.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Title */}
          <div className="space-y-1">
            <label htmlFor="directive-title" className="text-xs font-semibold text-slate-700">Alert Title</label>
            <Input
              id="directive-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Urgent Serve Available"
              className="text-xs h-8"
            />
          </div>

          {/* Message */}
          <div className="space-y-1">
            <label htmlFor="directive-msg" className="text-xs font-semibold text-slate-700">Directive Message</label>
            <Textarea
              id="directive-msg"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your directive for this server..."
              rows={3}
              className="text-xs"
            />
          </div>

          {/* Priority */}
          <div className="flex items-center gap-3 text-xs">
            <span className="font-semibold text-slate-700">Priority:</span>
            {(["normal", "high", "urgent"] as const).map((p) => (
              <label key={p} className="flex items-center gap-1 cursor-pointer capitalize">
                <input
                  type="radio"
                  name="directive-priority"
                  value={p}
                  checked={priority === p}
                  onChange={() => setPriority(p)}
                  className="text-amber-600"
                />
                {p}
              </label>
            ))}
          </div>
        </div>

        <DialogFooter className="flex justify-between sm:justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSendDirective}
            disabled={sending || !message.trim()}
            className="bg-amber-600 hover:bg-amber-700 text-white font-semibold"
          >
            {sending ? "Sending..." : "Send Directive"} <Send className="h-3.5 w-3.5 ml-1" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

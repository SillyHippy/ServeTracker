import React, { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  listPending,
  subscribePending,
  syncOutbox,
  removePending,
  isDurableStorage,
  type OutboxItem,
  type OutboxState,
} from "@/lib/offlineQueue";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Cloud,
  CloudOff,
  RefreshCw,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Camera,
  FileText,
  User,
  Database,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

interface PendingSyncDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function stateBadge(state: OutboxState) {
  switch (state) {
    case "pending":
      return <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-300">Pending Sync</Badge>;
    case "posting":
      return <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-300">Uploading...</Badge>;
    case "posted_unverified":
      return <Badge variant="outline" className="bg-indigo-50 text-indigo-800 border-indigo-300">Awaiting Confirm</Badge>;
    case "archived":
      return <Badge variant="outline" className="bg-amber-100 text-amber-900 border-amber-400">Archived (503)</Badge>;
    case "conflict":
      return <Badge variant="destructive">Conflict (409)</Badge>;
    case "blocked":
      return <Badge variant="destructive">Blocked</Badge>;
    case "skipped":
      return <Badge variant="secondary">Skipped (Already Served)</Badge>;
    case "verified":
      return <Badge className="bg-green-600 text-white">Verified</Badge>;
    default:
      return <Badge variant="outline">{state}</Badge>;
  }
}

export function PendingSyncDrawer({ open, onOpenChange }: PendingSyncDrawerProps) {
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const isDurable = isDurableStorage();

  useEffect(() => {
    const updateOnline = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  useEffect(() => {
    void listPending().then(setItems);
    const unsubscribe = subscribePending((fresh) => {
      setItems(fresh);
    });
    return unsubscribe;
  }, []);

  const handleSyncAll = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await syncOutbox({
        forceAll: true,
        postFn: (p) => api.createServeAttempt({ ...p, _offlineReplay: true }),
        confirmFn: (id, fp) => api.confirmServeAttempt(id, fp),
      });
      if (res.ok > 0) {
        toast({
          title: "Sync completed",
          description: `Successfully verified/synced ${res.ok} attempt(s).`,
        });
      } else if (res.fail > 0) {
        toast({
          title: "Sync incomplete",
          description: `${res.fail} attempt(s) could not be verified or encountered errors.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Outbox clear",
          description: "All offline attempts have already been verified.",
        });
      }
    } catch (err) {
      toast({
        title: "Sync failed",
        description: err instanceof Error ? err.message : "Error syncing outbox",
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleRetryItem = async (item: OutboxItem) => {
    if (retryingId) return;
    setRetryingId(item.id);
    try {
      const res = await syncOutbox({
        forceId: item.id,
        postFn: (p) => api.createServeAttempt({ ...p, _offlineReplay: true }),
        confirmFn: (id, fp) => api.confirmServeAttempt(id, fp),
      });
      const single = res.results.find((r) => r.id === item.id);
      if (single?.state === "verified") {
        toast({ title: "Verified", description: `Serve for ${item.personName || "case"} verified by server.` });
      } else if (single?.state === "skipped") {
        toast({ title: "Already Served", description: "No new attempt recorded (already served)." });
      } else if (single?.error) {
        toast({ title: "Retry result", description: single.error, variant: "destructive" });
      }
    } finally {
      setRetryingId(null);
    }
  };

  const handleDismissItem = async (item: OutboxItem) => {
    // Conflict / posted_unverified cannot be dismissed by standard users — only resolved skipped/verified
    if (item.state === "conflict") {
      if (!isAdmin) {
        toast({
          title: "Permission Denied",
          description: "Conflict records contain evidentiary attempt data and cannot be dismissed without admin authorization.",
          variant: "destructive",
        });
        return;
      }
      const confirmed = window.confirm(
        "ADMIN ACTION REQUIRED:\n\nDismissing this conflict will permanently erase local serve attempt and photo evidence that was rejected by the server.\n\nAre you sure you want to delete this evidence?"
      );
      if (!confirmed) return;
    } else if (item.state !== "skipped" && item.state !== "verified") {
      toast({
        title: "Cannot Dismiss",
        description: "Unverified and in-flight attempt evidence cannot be dismissed.",
        variant: "destructive",
      });
      return;
    }

    await removePending(item.id);
    toast({ title: "Item removed", description: "Attempt removed from offline outbox." });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0">
        <SheetHeader className="p-6 border-b">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-xl flex items-center gap-2">
              <Cloud className="h-5 w-5 text-indigo-600" />
              Offline Outbox
            </SheetTitle>
            <div className="flex items-center gap-2">
              {isOnline ? (
                <span className="flex items-center text-xs text-green-700 bg-green-50 px-2 py-1 rounded-full border border-green-200">
                  <span className="h-2 w-2 rounded-full bg-green-500 mr-1.5 animate-pulse" />
                  Online
                </span>
              ) : (
                <span className="flex items-center text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded-full border border-amber-200">
                  <CloudOff className="h-3 w-3 mr-1" />
                  Offline
                </span>
              )}
            </div>
          </div>
          <SheetDescription className="space-y-1">
            <span>
              {isDurable
                ? "Durable write-ahead storage in phone IndexedDB. Attempts sync and verify automatically."
                : "In-memory storage (non-durable; IndexedDB unavailable in this browser session)."}
            </span>
            {!isDurable && (
              <div className="flex items-center gap-1 text-xs text-amber-700 font-medium pt-1">
                <Database className="h-3.5 w-3.5" />
                <span>Notice: Storage is in RAM only and will reset if the page reloads.</span>
              </div>
            )}
          </SheetDescription>
        </SheetHeader>

        {/* Action bar with phone-first h-11 button */}
        <div className="p-4 bg-muted/40 border-b flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-foreground">
            {items.length} {items.length === 1 ? "attempt" : "attempts"} in outbox
          </span>
          <Button
            onClick={handleSyncAll}
            disabled={isSyncing || items.length === 0}
            className="h-11 min-h-[44px] px-4 text-sm font-semibold flex items-center justify-center"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? "animate-spin" : ""}`} />
            Sync All Now
          </Button>
        </div>

        {/* Outbox Items List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {items.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 text-green-500 mb-3" />
              <h4 className="font-semibold text-foreground">Outbox is Clear</h4>
              <p className="text-sm mt-1">All serve attempts have been safely uploaded and verified by the server.</p>
            </div>
          ) : (
            items.map((item) => {
              const photoCount = item.photoIds?.length || (Array.isArray(item.payload?.photos) ? (item.payload.photos as any).length : 0);
              const p = item.payload;
              const statusStr = String(p?.status || "attempt");
              const methodStr = String(p?.service_method || p?.serviceMethod || "");
              const formattedDate = new Date(item.createdAt).toLocaleString();
              const canDismiss = item.state === "skipped" || item.state === "verified" || (item.state === "conflict" && isAdmin);

              return (
                <div
                  key={item.id}
                  className="rounded-lg border bg-card p-4 shadow-sm text-card-foreground space-y-3 transition-colors hover:border-muted-foreground/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-sm flex items-center gap-1.5">
                        <User className="h-4 w-4 text-muted-foreground" />
                        {item.personName || "Recipient"}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <FileText className="h-3 w-3" />
                        Case: {item.caseNumber || item.caseId || "No case number"}
                      </div>
                    </div>
                    <div>{stateBadge(item.state)}</div>
                  </div>

                  <div className="text-xs text-muted-foreground grid grid-cols-2 gap-2 pt-1 border-t">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{formattedDate}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="capitalize font-medium text-foreground">
                        {statusStr} {methodStr ? `• ${methodStr}` : ""}
                      </span>
                    </div>
                    {photoCount > 0 && (
                      <div className="flex items-center gap-1 col-span-2">
                        <Camera className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{photoCount} {photoCount === 1 ? "photo" : "photos"} preserved locally</span>
                      </div>
                    )}
                  </div>

                  {item.lastError && (
                    <div className="rounded bg-destructive/10 text-destructive text-xs p-2 flex items-start gap-1.5">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span className="break-words flex-1 font-mono text-[11px]">{item.lastError}</span>
                    </div>
                  )}

                  {/* Phone-first stacked or flex action buttons with h-11 min-h-[44px] */}
                  <div className="flex items-center justify-between pt-2 border-t gap-2">
                    <span className="text-xs text-muted-foreground">
                      Attempts: {item.attempts}
                    </span>
                    <div className="flex items-center gap-2">
                      {canDismiss && (
                        <Button
                          variant="ghost"
                          className="h-11 min-h-[44px] px-3 text-xs text-destructive hover:bg-destructive/10"
                          onClick={() => handleDismissItem(item)}
                        >
                          <Trash2 className="h-4 w-4 mr-1.5" />
                          Dismiss
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        className="h-11 min-h-[44px] px-4 text-xs font-medium"
                        disabled={retryingId === item.id || isSyncing}
                        onClick={() => handleRetryItem(item)}
                      >
                        <RefreshCw className={`h-4 w-4 mr-1.5 ${retryingId === item.id ? "animate-spin" : ""}`} />
                        Retry Now
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

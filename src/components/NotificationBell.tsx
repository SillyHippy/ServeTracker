import React, { useEffect, useState } from "react";
import { Bell, Check, CheckCheck, Inbox, AlertTriangle, UserCheck, ShieldAlert, Sparkles, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { api } from "@/lib/api";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

export interface NotificationItem {
  id: string;
  user_id: string;
  type: string;
  priority: "low" | "normal" | "high" | "urgent";
  title: string;
  body: string;
  entity_type?: string;
  entity_id?: string;
  action_url?: string;
  read_at?: string;
  created_at: string;
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchNotifications = async () => {
    try {
      const res = await apiFetchNotifications();
      setNotifications(res.notifications || []);
      setUnreadCount(res.unreadCount || 0);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchNotifications();
    const timer = setInterval(fetchNotifications, 20000); // 20s poll
    return () => clearInterval(timer);
  }, []);

  const markRead = async (id: string, actionUrl?: string) => {
    try {
      await apiMarkNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      if (actionUrl) {
        setOpen(false);
        navigate(actionUrl);
      }
    } catch {
      // ignore
    }
  };

  const markAllRead = async () => {
    try {
      await apiMarkAllNotificationsRead();
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, read_at: new Date().toISOString() }))
      );
      setUnreadCount(0);
    } catch {
      // ignore
    }
  };

  const renderIcon = (type: string, priority: string) => {
    if (priority === "urgent" || type === "case_recalled") {
      return <ShieldAlert className="h-4 w-4 text-red-600" />;
    }
    if (type === "nudge") {
      return <Send className="h-4 w-4 text-amber-500" />;
    }
    if (type === "case_assigned") {
      return <UserCheck className="h-4 w-4 text-blue-600" />;
    }
    if (type === "serve_complete") {
      return <CheckCheck className="h-4 w-4 text-emerald-600" />;
    }
    return <Bell className="h-4 w-4 text-slate-600" />;
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative min-h-10 min-w-10 h-10 w-10">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-extrabold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
          <span className="sr-only">Notifications</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[85vw] sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="p-4 border-b shrink-0 flex flex-row items-center justify-between">
          <div>
            <SheetTitle className="text-base flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Notifications
            </SheetTitle>
            <SheetDescription className="text-xs">
              {unreadCount > 0 ? `${unreadCount} unread alert${unreadCount === 1 ? "" : "s"}` : "All caught up"}
            </SheetDescription>
          </div>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={markAllRead} className="text-xs h-8">
              <Check className="h-3 w-3 mr-1" />
              Mark all read
            </Button>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto divide-y">
          {notifications.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground flex flex-col items-center">
              <Inbox className="h-10 w-10 mb-2 opacity-30" />
              <p className="text-sm font-medium">No notifications yet</p>
              <p className="text-xs">Assignments, nudges, and serve alerts appear here.</p>
            </div>
          ) : (
            notifications.map((n) => {
              const isUnread = !n.read_at;
              return (
                <div
                  key={n.id}
                  onClick={() => markRead(n.id, n.action_url)}
                  className={cn(
                    "p-3.5 transition-colors cursor-pointer hover:bg-slate-50 flex gap-3 items-start",
                    isUnread ? "bg-amber-50/40" : "bg-white"
                  )}
                >
                  <div className="mt-0.5 shrink-0">{renderIcon(n.type, n.priority)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <p className={cn("text-xs font-bold truncate", isUnread ? "text-slate-950" : "text-slate-700")}>
                        {n.title}
                      </p>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {new Date(n.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 leading-snug break-words">{n.body}</p>
                  </div>
                  {isUnread && <span className="h-2 w-2 rounded-full bg-blue-600 mt-1.5 shrink-0" />}
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Local helper fetching
async function apiFetchNotifications(): Promise<{ notifications: NotificationItem[]; unreadCount: number }> {
  const res = await fetch("/api/notifications");
  if (!res.ok) return { notifications: [], unreadCount: 0 };
  return res.json();
}

async function apiMarkNotificationRead(id: string) {
  return fetch(`/api/notifications/${id}/read`, { method: "PATCH" });
}

async function apiMarkAllNotificationsRead() {
  return fetch(`/api/notifications/read-all`, { method: "PATCH" });
}

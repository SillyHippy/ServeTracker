import React, { useState } from "react";
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
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useNotifications, NotificationItem } from "@/context/NotificationContext";

export type { NotificationItem };

export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, requestPush, pushPermission, markRead, markAllRead } = useNotifications();

  const handleNotificationClick = async (item: NotificationItem) => {
    await markRead(item.id);
    setOpen(false);
    if (item.action_url) {
      navigate(item.action_url);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "case_assigned":
        return <Sparkles className="h-4 w-4 text-blue-500 shrink-0" />;
      case "nudge":
        return <Bell className="h-4 w-4 text-amber-500 shrink-0" />;
      case "broadcast":
        return <Send className="h-4 w-4 text-purple-500 shrink-0" />;
      case "license_expiry":
        return <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />;
      case "affidavit_signed":
        return <UserCheck className="h-4 w-4 text-emerald-500 shrink-0" />;
      default:
        return <Bell className="h-4 w-4 text-slate-500 shrink-0" />;
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative min-h-10 min-w-10 h-10 w-10 text-slate-700 hover:text-slate-900"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-0.5 -right-0.5 h-5 min-w-5 px-1.5 flex items-center justify-center rounded-full text-[10px] font-bold shadow-xs animate-in zoom-in"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[85vw] sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="p-4 border-b">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base font-bold flex items-center gap-2">
              <Bell className="h-4 w-4 text-blue-600" />
              Notifications
              {unreadCount > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {unreadCount} unread
                </Badge>
              )}
            </SheetTitle>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void markAllRead()}
                className="text-xs text-blue-600 hover:text-blue-700 h-8 px-2"
              >
                <CheckCheck className="h-3.5 w-3.5 mr-1" />
                Mark all read
              </Button>
            )}
          </div>
          <SheetDescription className="text-xs text-muted-foreground">
            Directives, assignments, and real-time alerts.
          </SheetDescription>

          {pushPermission !== "granted" && (
            <div className="mt-2 p-2.5 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between text-xs">
              <span className="text-blue-900 font-medium">Enable mobile lock-screen alerts?</span>
              <Button
                size="sm"
                variant="default"
                onClick={() => void requestPush()}
                className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
              >
                Enable Push
              </Button>
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto divide-y">
          {notifications.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Inbox className="h-10 w-10 mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-medium">No notifications</p>
              <p className="text-xs mt-1">You are all caught up!</p>
            </div>
          ) : (
            notifications.map((n) => {
              const isUnread = !n.read_at;
              return (
                <div
                  key={n.id}
                  onClick={() => void handleNotificationClick(n)}
                  className={cn(
                    "p-3.5 text-left transition cursor-pointer flex gap-3 items-start hover:bg-slate-50",
                    isUnread ? "bg-blue-50/40 font-medium" : "text-slate-600"
                  )}
                >
                  <div className="mt-0.5">{getIcon(n.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className={cn("text-xs leading-tight font-semibold", isUnread ? "text-slate-900" : "text-slate-700")}>
                        {n.title}
                      </p>
                      {isUnread && (
                        <span className="h-2 w-2 rounded-full bg-blue-600 shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                      {n.body}
                    </p>
                    <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
                      <span>{new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      {isUnread && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            void markRead(n.id);
                          }}
                          className="h-5 px-1.5 text-[10px] text-slate-500 hover:text-slate-900"
                        >
                          <Check className="h-3 w-3 mr-0.5" /> mark read
                        </Button>
                      )}
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

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { registerPushSubscription } from "@/lib/pushSubscription";
import { API_BASE } from "@/lib/api";

export interface NotificationItem {
  id: string;
  type: string;
  priority: "low" | "normal" | "high" | "urgent";
  title: string;
  body: string;
  action_url?: string;
  read_at?: string;
  created_at: string;
}

interface NotificationContextValue {
  notifications: NotificationItem[];
  unreadCount: number;
  loading: boolean;
  pushPermission: NotificationPermission;
  requestPush: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  refresh: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

const STORAGE_KEY_SEEN = "servetracker_seen_notif_ids_v2";

function getStoredSeenIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SEEN);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function saveStoredSeenIds(set: Set<string>) {
  try {
    const arr = Array.from(set).slice(-100);
    localStorage.setItem(STORAGE_KEY_SEEN, JSON.stringify(arr));
  } catch {
    // ignore
  }
}

async function apiFetchNotifications(): Promise<{ notifications: NotificationItem[]; unreadCount: number }> {
  try {
    const res = await fetch(`${API_BASE}/api/notifications`, { credentials: "include" });
    if (!res.ok) return { notifications: [], unreadCount: 0 };
    return await res.json();
  } catch {
    return { notifications: [], unreadCount: 0 };
  }
}

async function apiMarkNotificationRead(id: string) {
  try {
    return await fetch(`${API_BASE}/api/notifications/${id}/read`, { method: "PATCH", credentials: "include" });
  } catch {
    // ignore
  }
}

async function apiMarkAllNotificationsRead() {
  try {
    return await fetch(`${API_BASE}/api/notifications/read-all`, { method: "PATCH", credentials: "include" });
  } catch {
    // ignore
  }
}

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );

  const seenIdsRef = useRef<Set<string>>(getStoredSeenIds());
  const isFirstFetchRef = useRef(true);

  const triggerSystemNotification = async (title: string, body: string, tag?: string, url = "/dashboard") => {
    try {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, {
          body,
          icon: "/icon-192.png",
          badge: "/badge-96.png",
          tag: tag || "servetracker-alert",
          data: { url },
        } as any);
      } else {
        new Notification(title, { body, icon: "/icon-192.png", badge: "/badge-96.png" } as any);
      }
    } catch (err) {
      console.warn("Could not trigger system notification:", err);
    }
  };

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await apiFetchNotifications();
      const list: NotificationItem[] = res.notifications || [];
      setNotifications(list);
      setUnreadCount(res.unreadCount || 0);

      const seen = seenIdsRef.current;

      // On first boot/load: silently record all existing IDs so no past notification ever alerts
      if (isFirstFetchRef.current) {
        list.forEach((n) => seen.add(n.id));
        saveStoredSeenIds(seen);
        isFirstFetchRef.current = false;
        return;
      }

      // On subsequent polls: ONLY alert in-app toast for items never seen before
      // (System lock-screen notification is already delivered once via Service Worker Web Push)
      const brandNew = list.filter((n) => !n.read_at && !seen.has(n.id));
      for (const item of brandNew) {
        seen.add(item.id);
        toast(item.title, {
          description: item.body,
          duration: 4000,
        });
      }

      if (brandNew.length > 0) {
        saveStoredSeenIds(seen);
      }
    } catch {
      // ignore
    }
  }, []);

  const requestPush = async () => {
    if (typeof Notification === "undefined") return;
    try {
      const perm = await Notification.requestPermission();
      setPushPermission(perm);
      if (perm === "granted") {
        await registerPushSubscription();
        await triggerSystemNotification(
          "ServeTracker Alerts Active 🔔",
          "You will receive real-time push alerts for case assignments and admin directives.",
          "welcome-alert"
        );
      }
    } catch {
      // ignore
    }
  };

  const markRead = async (id: string) => {
    try {
      await apiMarkNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // ignore
    }
  };

  const markAllRead = async () => {
    try {
      await apiMarkAllNotificationsRead();
      const now = new Date().toISOString();
      setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || now })));
      setUnreadCount(0);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void fetchNotifications();
    const interval = setInterval(fetchNotifications, 10000); // 10s poll
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      registerPushSubscription().catch(() => {});
    }
  }, []);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        pushPermission,
        requestPush,
        markRead,
        markAllRead,
        refresh: fetchNotifications,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error("useNotifications must be used within a NotificationProvider");
  }
  return ctx;
};

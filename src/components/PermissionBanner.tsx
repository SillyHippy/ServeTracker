import React, { useEffect, useState } from "react";
import { Bell, BellOff, MapPin, MapPinOff, AlertTriangle, X, ShieldAlert, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { subscribeToPush } from "@/lib/push";

export default function PermissionBanner() {
  const { toast } = useToast();
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>("granted");
  const [geoPerm, setGeoPerm] = useState<PermissionState | "prompt">("granted");
  const [showHelpDialog, setShowHelpDialog] = useState(false);
  const [helpType, setHelpType] = useState<"notification" | "geolocation">("notification");
  const [dismissed, setDismissed] = useState(false);

  const checkAndAutoPromptLocation = async () => {
    // 1. Check Notification status
    if (typeof Notification !== "undefined") {
      setNotifPerm(Notification.permission);
    }

    // 2. Check Geolocation status & Auto-Prompt if in prompt mode
    if (typeof navigator !== "undefined" && "permissions" in navigator) {
      try {
        const geoStatus = await navigator.permissions.query({ name: "geolocation" as PermissionName });
        setGeoPerm(geoStatus.state);
        
        // If browser is waiting to prompt, trigger the native location dialog automatically on user session
        if (geoStatus.state === "prompt" && navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            () => {
              setGeoPerm("granted");
            },
            () => {
              // User dismissed or denied
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
          );
        }

        geoStatus.onchange = () => {
          setGeoPerm(geoStatus.state);
        };
      } catch {
        // Fallback for browsers without permissions.query
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            () => setGeoPerm("granted"),
            (err) => {
              if (err.code === err.PERMISSION_DENIED) setGeoPerm("denied");
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
          );
        }
      }
    }
  };

  useEffect(() => {
    checkAndAutoPromptLocation();
    window.addEventListener("focus", checkAndAutoPromptLocation);
    window.addEventListener("visibilitychange", checkAndAutoPromptLocation);
    return () => {
      window.removeEventListener("focus", checkAndAutoPromptLocation);
      window.removeEventListener("visibilitychange", checkAndAutoPromptLocation);
    };
  }, []);

  const handleEnableNotification = async () => {
    if (typeof Notification === "undefined") return;

    if (Notification.permission === "denied") {
      setHelpType("notification");
      setShowHelpDialog(true);
      return;
    }

    try {
      const perm = await Notification.requestPermission();
      setNotifPerm(perm);
      if (perm === "granted") {
        // Real background push: subscribe via Push API + register with the server
        await subscribeToPush();
        toast({
          title: "Notifications Enabled 🔔",
          description: "You will now receive instant push alerts for job dispatches and directives.",
        });
        if ("serviceWorker" in navigator) {
          const reg = await navigator.serviceWorker.ready;
          await reg.showNotification("ServeTracker Alerts Active 🔔", {
            body: "You will receive real-time push alerts for case assignments and admin directives.",
            icon: "/icon-192.png",
            badge: "/icon-192.png",
          } as any);
        }
      } else if (perm === "denied") {
        setHelpType("notification");
        setShowHelpDialog(true);
      }
    } catch (err) {
      console.warn("Permission request error:", err);
    }
  };

  const handleEnableLocation = () => {
    if (!navigator.geolocation) return;

    if (geoPerm === "denied") {
      setHelpType("geolocation");
      setShowHelpDialog(true);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      () => {
        setGeoPerm("granted");
        toast({
          title: "Location Access Granted 📍",
          description: "GPS coordinates will be accurately stamped on your court serve attempts.",
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGeoPerm("denied");
          setHelpType("geolocation");
          setShowHelpDialog(true);
        }
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  if (dismissed) return null;

  const showNotifBanner = notifPerm !== "granted";
  const showGeoBanner = notifPerm === "granted" && geoPerm !== "granted";

  if (!showNotifBanner && !showGeoBanner) return null;

  return (
    <>
      <div className="w-full bg-slate-900 border-b border-slate-800 text-white px-3 sm:px-4 py-2.5 shadow-md">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-start sm:items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded-full bg-amber-500/20 text-amber-400 shrink-0 mt-0.5 sm:mt-0">
              {showNotifBanner ? <BellOff className="h-4 w-4" /> : <MapPinOff className="h-4 w-4" />}
            </div>
            <div className="text-xs text-slate-200 leading-snug">
              {showNotifBanner ? (
                <>
                  <strong className="text-white font-semibold">Notifications are off.</strong> Enable push alerts to receive instant job dispatches and urgent directives.
                </>
              ) : (
                <>
                  <strong className="text-white font-semibold">GPS Location is disabled.</strong> Location is required to stamp valid court coordinates on attempts.
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
            {showNotifBanner ? (
              <Button
                size="sm"
                onClick={handleEnableNotification}
                className="h-7 px-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-xs"
              >
                <Bell className="h-3.5 w-3.5 mr-1" />
                {notifPerm === "denied" ? "How to Fix" : "Enable Alerts"}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleEnableLocation}
                className="h-7 px-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs"
              >
                <MapPin className="h-3.5 w-3.5 mr-1" />
                {geoPerm === "denied" ? "How to Fix" : "Allow Location"}
              </Button>
            )}

            <button
              onClick={() => setDismissed(true)}
              className="text-slate-400 hover:text-white p-1 rounded transition ml-1"
              title="Dismiss banner"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Permission Help Dialog */}
      <Dialog open={showHelpDialog} onOpenChange={setShowHelpDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {helpType === "notification" ? "How to Re-Enable Notifications" : "How to Re-Enable Location Access"}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              {helpType === "notification"
                ? "Notifications were blocked in your device settings. Follow these quick steps to turn them on:"
                : "Location access is blocked. Follow these quick steps to allow court GPS stamping:"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs text-slate-700">
            {/* iOS Instructions */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5">
              <div className="font-bold text-slate-900 flex items-center gap-1.5">
                📱 iPhone / iPad (iOS Settings)
              </div>
              <ol className="list-decimal pl-4 space-y-1 text-slate-600">
                <li>Open your iPhone <strong>Settings</strong> app.</li>
                <li>Scroll down and tap <strong>{helpType === "notification" ? "Notifications" : "Privacy & Security ➔ Location Services"}</strong>.</li>
                <li>Find <strong>ServeTracker / Safari</strong> and select <strong>Allow / While Using App</strong>.</li>
                <li>Return to ServeTracker and refresh.</li>
              </ol>
            </div>

            {/* Android Instructions */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5">
              <div className="font-bold text-slate-900 flex items-center gap-1.5">
                🤖 Android / Samsung (Chrome Settings)
              </div>
              <ol className="list-decimal pl-4 space-y-1 text-slate-600">
                <li>Tap the <strong>Site Settings / Lock / Info</strong> icon next to the address bar (or long-press the PWA app icon ➔ <strong>App info</strong>).</li>
                <li>Tap <strong>Permissions</strong> ➔ <strong>{helpType === "notification" ? "Notifications" : "Location"}</strong>.</li>
                <li>Select <strong>Allow</strong>.</li>
              </ol>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                setShowHelpDialog(false);
                checkAndAutoPromptLocation();
              }}
            >
              I've Updated My Settings
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

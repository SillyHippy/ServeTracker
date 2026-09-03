import { API_BASE } from "./publicBase";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function registerPushSubscription(): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return false;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.pushManager) return false;

    // 1. Fetch server's VAPID Public Key
    const keyRes = await fetch(`${API_BASE}/api/push/vapid-public-key`, { credentials: "include" });
    if (!keyRes.ok) return false;
    const { publicKey } = await keyRes.json();
    if (!publicKey) return false;

    // 2. Check existing subscription or subscribe new
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const convertedKey = urlBase64ToUint8Array(publicKey);
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey,
      });
    }

    if (!sub) return false;

    const subJson = sub.toJSON();
    const platform = /iPhone|iPad|iPod/i.test(navigator.userAgent)
      ? "ios"
      : /Android/i.test(navigator.userAgent)
      ? "android"
      : "desktop";

    // 3. Post to backend
    const res = await fetch(`${API_BASE}/api/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        endpoint: sub.endpoint,
        keys: subJson.keys,
        platform,
      }),
    });

    return res.ok;
  } catch (err) {
    console.warn("[PushSubscription] Failed to register push subscription:", err);
    return false;
  }
}

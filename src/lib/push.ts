// Web Push subscription helper — real background push via Push API + VAPID.
// Flow: request permission -> get VAPID public key from server ->
// pushManager.subscribe({ userVisibleOnly, applicationServerKey }) ->
// POST the subscription to /api/push-subscriptions so the server can wake
// this device in real time when a nudge / directive is sent.

const PUSH_SUB_API = "/api/push-subscriptions";
const VAPID_KEY_API = "/api/push/vapid-public-key";

/** Convert a base64url VAPID key to the Uint8Array pushManager.subscribe expects. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** Rough device-family detection, stored per subscription for logs. */
export function detectPlatform(): string {
  const ua = navigator.userAgent || "";
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/windows/i.test(ua)) return "windows";
  if (/mac os/i.test(ua)) return "macos";
  if (/linux/i.test(ua)) return "linux";
  return "unknown";
}

async function getVapidPublicKey(): Promise<string> {
  const res = await fetch(VAPID_KEY_API);
  if (!res.ok) throw new Error(`VAPID key endpoint returned ${res.status}`);
  const data = (await res.json()) as { publicKey?: string };
  if (!data.publicKey) throw new Error("No VAPID public key in response");
  return data.publicKey;
}

/**
 * Ensure this device has an active push subscription and that the server
 * knows about it. Safe to call repeatedly (upserts + refreshes last_seen_at).
 * Returns true when the device is subscribed and registered.
 */
export async function subscribeToPush(): Promise<boolean> {
  try {
    if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) return false;
    if (Notification.permission !== "granted") return false;

    const reg = await navigator.serviceWorker.ready;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      // First time (or key rotation): create a real subscription with VAPID.
      const publicKey = await getVapidPublicKey();
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    // PushSubscription.toJSON() -> { endpoint, keys: { p256dh, auth } }
    const json = sub.toJSON() as {
      endpoint: string;
      keys?: { p256dh?: string; auth?: string };
    };
    const p256dh = json.keys?.p256dh || "";
    const auth = json.keys?.auth || "";
    if (!p256dh || !auth) throw new Error("Subscription is missing encryption keys");

    const res = await fetch(PUSH_SUB_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: sub.endpoint,
        keys: { p256dh, auth },
        platform: detectPlatform(),
      }),
    });
    return res.ok;
  } catch (err) {
    console.warn("[Push] Subscription failed:", err);
    return false;
  }
}

/** Unsubscribe this device locally and remove the endpoint from the server. */
export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    if (!("serviceWorker" in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return true;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    try {
      await fetch(PUSH_SUB_API, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
    } catch {
      // server-side cleanup is best-effort
    }
    return true;
  } catch (err) {
    console.warn("[Push] Unsubscribe failed:", err);
    return false;
  }
}

/**
 * Wire the push-subscription lifecycle: when the browser rotates push keys
 * (pushsubscriptionchange event forwarded by the service worker), re-subscribe
 * and re-register with the server so background push keeps working.
 */
export function initPushSubscriptionLifecycle(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    if (event.data && event.data.type === "PUSH_SUBSCRIPTION_CHANGE") {
      subscribeToPush()
        .then((ok) => console.log(ok ? "[Push] Subscription refreshed after key rotation" : "[Push] Resubscription failed"))
        .catch((err) => console.warn("[Push] Resubscription error:", err));
    }
  });
}

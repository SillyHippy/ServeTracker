import { Database } from "bun:sqlite";
import webpush from "web-push";
import { sendSms } from "./sms";

// Initialize VAPID keys if provided
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || "mailto:info@justlegalsolutions.org";

if (vapidPublicKey && vapidPrivateKey) {
  try {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    console.log("[WebPush] VAPID details configured successfully");
  } catch (err) {
    console.warn("[WebPush] Failed to configure VAPID details:", err);
  }
}

/** Expose the VAPID public key so the browser can create a push subscription. */
export function getVapidPublicKey(): string | null {
  return vapidPublicKey ?? null;
}

export type NotificationType =
  | "case_assigned"
  | "nudge"
  | "case_recalled"
  | "deadline_warning"
  | "stale_job"
  | "broadcast"
  | "serve_attempt"
  | "serve_complete"
  | "affidavit_signed"
  | "license_expiry"
  | "payment_received";

export type NotificationPriority = "low" | "normal" | "high" | "urgent";

export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  platform: string;
  user_agent: string;
  created_at: string;
  last_seen_at: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string;
  entity_type?: string;
  entity_id?: string;
  action_url?: string;
  read_at?: string;
  created_at: string;
}

/** Simple unique ID generator */
function newId(prefix = "notif"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Automatically prune old notifications to keep the database lean and performant.
 * - Deletes read notifications older than 30 days.
 * - Deletes any notifications older than 90 days.
 * - Caps each user's history to the 50 most recent notifications.
 * - Purges inactive push subscriptions older than 60 days.
 */
export function cleanOldNotifications(db: Database) {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // 1. Delete read notifications older than 30 days
    db.query("DELETE FROM notifications WHERE read_at != '' AND read_at IS NOT NULL AND read_at < ?").run(thirtyDaysAgo);

    // 2. Delete all notifications older than 90 days
    db.query("DELETE FROM notifications WHERE created_at < ?").run(ninetyDaysAgo);

    // 3. Keep only the 50 most recent notifications per user
    db.query(`
      DELETE FROM notifications 
      WHERE id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn 
          FROM notifications
        ) WHERE rn <= 50
      )
    `).run();

    // 4. Clean inactive push subscriptions older than 60 days
    db.query("DELETE FROM push_subscriptions WHERE last_seen_at < ?").run(sixtyDaysAgo);
  } catch (err) {
    console.warn("[NotificationCleaner] Auto-cleanup error:", err);
  }
}

/**
 * Persist an in-app notification to the database and trigger targeted Web Push.
 */
export async function createNotification(
  db: Database,
  params: {
    userId: string;
    type: NotificationType;
    priority?: NotificationPriority;
    title: string;
    body: string;
    entityType?: string;
    entityId?: string;
    actionUrl?: string;
  }
): Promise<NotificationRow> {
  const id = newId("notif");
  const now = new Date().toISOString();
  const priority = params.priority || "normal";

  db.query(
    `INSERT INTO notifications (id, user_id, type, priority, title, body, entity_type, entity_id, action_url, read_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)`
  ).run(
    id,
    params.userId,
    params.type,
    priority,
    params.title,
    params.body,
    params.entityType || "",
    params.entityId || "",
    params.actionUrl || "",
    now
  );

  // Run auto-cleanup in the background so SQLite never bloats
  cleanOldNotifications(db);

  const row = db.query("SELECT * FROM notifications WHERE id = ?").get(id) as NotificationRow;

  // Background Web Push dispatch to the targeted user's devices (unique tag ensures distinct alerts stack)
  dispatchPushToUser(db, params.userId, {
    id,
    title: params.title,
    body: params.body,
    actionUrl: params.actionUrl || "/dashboard",
    tag: params.entityId ? `${params.type}:${params.entityId}:${id}` : `${params.type}:${id}`,
  }).catch((err) => {
    console.warn(`[PushDispatcher] Failed to dispatch push to user ${params.userId}:`, err);
  });

  // Targeted SMS Dispatch if user has phone on file and SMS alerts enabled
  try {
    const userRow = db.query(
      "SELECT phone, phone_sms_enabled FROM users WHERE id = ?"
    ).get(params.userId) as { phone?: string; phone_sms_enabled?: number } | null;

    const userPhone = userRow?.phone || "";
    const smsEnabled = userRow?.phone_sms_enabled !== 0;

    if (userPhone && smsEnabled) {
      const actionLink = params.actionUrl ? `\nhttps://servetracker.justlegalsolutions.org${params.actionUrl}` : "";
      sendSms({
        userId: params.userId,
        to: userPhone,
        message: `[Serve Tracker] ${params.title}\n${params.body}${actionLink}`,
        priority: priority === "urgent" ? "urgent" : priority === "high" ? "high" : "normal",
      }).catch((err) => {
        console.warn(`[SmsDispatcher] Failed to dispatch SMS to user ${params.userId}:`, err);
      });
    }
  } catch (smsErr) {
    console.warn("[SmsDispatcher] Exception checking user phone:", smsErr);
  }

  return row;
}

/**
 * Dispatch notification to all active Admins.
 */
export async function notifyAdmins(
  db: Database,
  params: {
    type: NotificationType;
    priority?: NotificationPriority;
    title: string;
    body: string;
    entityType?: string;
    entityId?: string;
    actionUrl?: string;
  }
) {
  const adminRows = db.query("SELECT id FROM users WHERE role = 'admin' AND is_active = 1").all() as { id: string }[];
  for (const admin of adminRows) {
    await createNotification(db, {
      ...params,
      userId: admin.id,
    });
  }
}

/**
 * Web Push Dispatcher using real VAPID cryptographic web-push protocol
 */
async function dispatchPushToUser(
  db: Database,
  userId: string,
  payload: { id?: string; title: string; body: string; actionUrl: string; tag?: string }
) {
  const subs = db.query(
    "SELECT * FROM push_subscriptions WHERE user_id = ?"
  ).all(userId) as PushSubscriptionRow[];

  if (!subs.length) return;

  const pushPayload = JSON.stringify({
    id: payload.id || "",
    title: payload.title,
    body: payload.body,
    actionUrl: payload.actionUrl || "/dashboard",
    url: payload.actionUrl || "/dashboard",
    tag: payload.tag || `servetracker_${payload.id || Date.now()}`,
  });

  for (const sub of subs) {
    if (!sub.endpoint || !sub.p256dh || !sub.auth) continue;

    const pushSub = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dh,
        auth: sub.auth,
      },
    };

    try {
      if (vapidPublicKey && vapidPrivateKey) {
        // TTL 300s: deliver within 5 min even if the device is briefly offline;
        // urgency high wakes the device immediately for nudges/directives.
        await webpush.sendNotification(pushSub, pushPayload, { TTL: 300, urgency: "high" });
        console.log(`[WebPush] Sent real-time push to ${sub.platform} for user ${userId}: "${payload.title}"`);
      } else {
        console.log(`[WebPush] (No VAPID) Logged push to ${sub.platform}: "${payload.title}"`);
      }
    } catch (err: any) {
      console.warn(`[WebPush] Push failed for endpoint ${sub.endpoint.slice(0, 30)}:`, err?.statusCode || err);
      // Prune expired or unsubscribed tokens (404 Gone or 410 Expired)
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        db.query("DELETE FROM push_subscriptions WHERE id = ?").run(sub.id);
        console.log(`[WebPush] Pruned expired push subscription ${sub.id}`);
      }
    }
  }
}

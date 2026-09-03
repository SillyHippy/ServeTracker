import { Database } from "bun:sqlite";
import { join } from "path";
import { DATA_DIR } from "./db";

const DB_PATH = join(DATA_DIR, "pdfusaedit.db");
let _smsDb: Database | null = null;
function getDb(): Database {
  if (!_smsDb) {
    _smsDb = new Database(DB_PATH);
    _smsDb.exec("PRAGMA journal_mode = WAL;");
    _smsDb.exec("PRAGMA busy_timeout = 5000;");
  }
  return _smsDb;
}

export interface SendSmsParams {
  userId?: string;
  to: string;
  message: string;
  priority?: "normal" | "high" | "urgent";
}

/**
 * Normalizes US phone numbers cleanly:
 * Handles (918) 805-7847, 918-805-7847, 9188057847, 19188057847, +19188057847
 */
export function normalizePhoneNumber(raw: string): string {
  let cleaned = (raw || "").replace(/\D/g, "");
  if (cleaned.length === 10) {
    cleaned = "1" + cleaned;
  }
  if (!cleaned.startsWith("+")) {
    cleaned = "+" + cleaned;
  }
  return cleaned;
}

export async function sendSms(params: SendSmsParams): Promise<{ success: boolean; id?: string; error?: string }> {
  const isEnabled = (process.env.SMS_GATEWAY_ENABLED || "false") === "true";
  const user = process.env.SMS_GATEWAY_USER || "";
  const pass = process.env.SMS_GATEWAY_PASS || "";
  const apiUrl = process.env.SMS_GATEWAY_API_URL || "https://api.sms-gate.app/3rdparty/v1/messages";
  const deviceId = process.env.SMS_GATEWAY_DEVICE_ID || "";

  if (!isEnabled) {
    console.log("[SMS] SMS Gateway is disabled in environment");
    return { success: false, error: "SMS Gateway disabled" };
  }

  const phone = normalizePhoneNumber(params.to);
  if (phone.length < 11) {
    console.warn(`[SMS] Invalid phone number passed: "${params.to}"`);
    return { success: false, error: "Invalid phone number" };
  }

  const logId = `sms_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();
  const db = getDb();

  try {
    db.query(
      `INSERT INTO sms_logs (id, remote_id, user_id, phone_number, message, status, created_at, updated_at)
       VALUES (?, '', ?, ?, ?, 'pending', ?, ?)`
    ).run(logId, params.userId || "", phone, params.message, now, now);
  } catch (err) {
    console.warn("[SMS] Failed to write initial sms_log:", err);
  }

  // Non-blocking async fetch
  setTimeout(async () => {
    try {
      const authHeader = "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Authorization": authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          textMessage: { text: params.message },
          phoneNumbers: [phone],
          deviceId: deviceId || undefined,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`[SMS] Relay returned HTTP ${res.status}:`, errText);
        db.query(
          "UPDATE sms_logs SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?"
        ).run(errText.slice(0, 500), new Date().toISOString(), logId);
        return;
      }

      const resData = (await res.json()) as { id?: string };
      const remoteId = resData?.id || "";
      db.query(
        "UPDATE sms_logs SET status = 'processed', remote_id = ?, updated_at = ? WHERE id = ?"
      ).run(remoteId, new Date().toISOString(), logId);
      console.log(`[SMS] Dispatched SMS (${remoteId || logId}) to ${phone}: "${params.message.slice(0, 40)}..."`);
    } catch (fetchErr: any) {
      console.error(`[SMS] Network dispatch error for ${phone}:`, fetchErr?.message || fetchErr);
      try {
        db.query(
          "UPDATE sms_logs SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?"
        ).run(String(fetchErr?.message || fetchErr).slice(0, 500), new Date().toISOString(), logId);
      } catch {}
    }
  }, 0);

  return { success: true, id: logId };
}

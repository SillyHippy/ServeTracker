/**
 * Field offline write-ahead outbox: phone is a holding tank, server DB is source of truth.
 * Every delivery payload is written to IndexedDB BEFORE the first network call.
 * Stable id is reused across retries so duplicate rows are never created.
 *
 * State Machine:
 *   pending -> posting -> posted_unverified -> verified
 *   Terminal/Exception states: blocked (400/403), conflict (409), skipped (already_served), archived (503)
 */

import {
  computePayloadFingerprint,
  hashPhotoContent,
  type ServePayloadInput,
} from "./serveFingerprint";

export { computePayloadFingerprint };

export const DB_NAME = "servetracker-offline";
export const DB_VERSION = 2;
export const STORE_PENDING = "pending_serves";
export const STORE_PHOTOS = "outbox_photos";

export type OutboxState =
  | "pending"
  | "posting"
  | "posted_unverified"
  | "verified"
  | "archived"
  | "conflict"
  | "blocked"
  | "skipped";

export interface ServerReceipt {
  committed?: boolean;
  persisted?: boolean;
  serveId?: string;
  payloadFingerprint?: string;
  attemptNumber?: number;
  photoCount?: number;
  committedAt?: string;
  syncVersion?: string | number;
  archived?: boolean;
  retry?: boolean;
  skipped?: boolean;
  reason?: string;
  [key: string]: unknown;
}

export interface StoredPhoto {
  id: string;
  serveId: string;
  position: number;
  imageData: string;
  timestamp?: string;
}

export interface OutboxItem {
  id: string;
  eventId: string;
  caseId: string;
  caseNumber?: string;
  recipientId?: string;
  personName?: string;
  state: OutboxState;
  fingerprint: string;
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  serverReceipt?: ServerReceipt;
  payload: Record<string, unknown>;
  photoIds?: string[];
}

// Backward-compatible alias
export type PendingServe = OutboxItem;

export class StorageQuotaError extends Error {
  constructor(message = "Storage quota exceeded on this device. Free up storage to save photos and attempts.") {
    super(message);
    this.name = "StorageQuotaError";
  }
}

type Listener = (items: OutboxItem[]) => void;
const listeners = new Set<Listener>();

function notify(items: OutboxItem[]) {
  for (const fn of listeners) {
    try {
      fn(items);
    } catch {
      /* ignore */
    }
  }
}

// Test / mock simulation hooks
let simulateQuotaError = false;
let simulateOpenDbError = false;
let simulateTxError = false;
let simulateReadBackError = false;

export function __setSimulateQuotaError(val: boolean) {
  simulateQuotaError = val;
}
export function __setSimulateOpenDbError(val: boolean) {
  simulateOpenDbError = val;
}
export function __setSimulateTxError(val: boolean) {
  simulateTxError = val;
}
export function __setSimulateReadBackError(val: boolean) {
  simulateReadBackError = val;
}

// In-memory fallback ONLY for environments without IndexedDB (e.g. test runners without DOM)
const memItems = new Map<string, OutboxItem>();
const memPhotos = new Map<string, StoredPhoto>();

export function __clearMemoryStores() {
  memItems.clear();
  memPhotos.clear();
}

export function hasIndexedDB(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

export function isDurableStorage(): boolean {
  return hasIndexedDB();
}

function openDb(): Promise<IDBDatabase> {
  if (simulateOpenDbError) {
    return Promise.reject(new Error("Simulated IndexedDB open failure"));
  }
  return new Promise((resolve, reject) => {
    if (!hasIndexedDB()) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PENDING)) {
        const store = db.createObjectStore(STORE_PENDING, { keyPath: "id" });
        try {
          store.createIndex("caseId", "caseId", { unique: false });
          store.createIndex("state", "state", { unique: false });
          store.createIndex("eventId", "eventId", { unique: false });
        } catch {
          /* ignore */
        }
      }
      if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
        const photoStore = db.createObjectStore(STORE_PHOTOS, { keyPath: "id" });
        try {
          photoStore.createIndex("serveId", "serveId", { unique: false });
        } catch {
          /* ignore */
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      const err = tx.error;
      if (err && (err.name === "QuotaExceededError" || /quota/i.test(err.message || ""))) {
        reject(new StorageQuotaError());
      } else {
        reject(err || new Error("IndexedDB tx failed"));
      }
    };
    tx.onabort = () => {
      const err = tx.error;
      if (err && (err.name === "QuotaExceededError" || /quota/i.test(err.message || ""))) {
        reject(new StorageQuotaError());
      } else {
        reject(err || new Error("IndexedDB tx aborted"));
      }
    };
  });
}

export function newOfflineId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `off_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
}

export function isNetworkFailure(error: unknown): boolean {
  if (!error) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes("Failed to fetch") ||
    msg.includes("NetworkError") ||
    msg.includes("network") ||
    msg.includes("offline") ||
    msg.includes("timed out") ||
    msg.includes("AbortError") ||
    msg.includes("Connection reset") ||
    msg.includes("Load failed")
  );
}

export function subscribePending(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function listPending(): Promise<OutboxItem[]> {
  if (!hasIndexedDB()) {
    return Array.from(memItems.values());
  }
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PENDING, "readonly");
      const store = tx.objectStore(STORE_PENDING);
      const req = store.getAll();
      req.onsuccess = () => {
        db.close();
        resolve((req.result || []) as OutboxItem[]);
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    });
  } catch (err) {
    if (!hasIndexedDB()) return Array.from(memItems.values());
    throw err;
  }
}

export async function getOutboxItem(id: string): Promise<OutboxItem | undefined> {
  if (!hasIndexedDB()) {
    return memItems.get(id);
  }
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PENDING, "readonly");
    const store = tx.objectStore(STORE_PENDING);
    const req = store.get(id);
    req.onsuccess = () => {
      db.close();
      resolve(req.result as OutboxItem | undefined);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export async function getPhotosForServe(serveId: string): Promise<StoredPhoto[]> {
  if (!hasIndexedDB()) {
    const res: StoredPhoto[] = [];
    for (const p of memPhotos.values()) {
      if (p.serveId === serveId) res.push(p);
    }
    return res.sort((a, b) => (a.position ?? 1) - (b.position ?? 1));
  }
  const db = await openDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_PHOTOS, "readonly");
      const store = tx.objectStore(STORE_PHOTOS);
      const idx = store.index("serveId");
      const req = idx.getAll(serveId);
      req.onsuccess = () => {
        db.close();
        const photos = (req.result || []) as StoredPhoto[];
        resolve(photos.sort((a, b) => (a.position ?? 1) - (b.position ?? 1)));
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    } catch (e) {
      db.close();
      reject(e);
    }
  });
}

/**
 * Rehydrate full photo bytes into serve payload before network POST.
 */
export async function rehydrateServePayload(item: OutboxItem): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = { ...item.payload, id: item.id };
  const photos = await getPhotosForServe(item.id);
  if (photos.length > 0) {
    payload.photos = photos.map((p) => ({
      id: p.id,
      position: p.position ?? 1,
      imageData: p.imageData,
      timestamp: p.timestamp,
    }));
    if (photos.length === 1 && !item.payload.photos) {
      payload.imageData = photos[0].imageData;
    }
  }
  return payload;
}

export async function hasUnverifiedAttemptsForCase(caseIdOrNumber: string): Promise<boolean> {
  if (!caseIdOrNumber) return false;
  const key = String(caseIdOrNumber).trim().toLowerCase();
  const items = await listPending();
  return items.some((item) => {
    if (["verified", "skipped"].includes(item.state)) return false;
    const itemCaseId = String(item.caseId || item.payload?.case_id || "").trim().toLowerCase();
    const itemCaseNum = String(item.caseNumber || item.payload?.case_number || item.payload?.caseNumber || "").trim().toLowerCase();
    return (itemCaseId && itemCaseId === key) || (itemCaseNum && itemCaseNum === key);
  });
}

export async function getPendingForCase(caseIdOrNumber: string): Promise<OutboxItem[]> {
  if (!caseIdOrNumber) return [];
  const key = String(caseIdOrNumber).trim().toLowerCase();
  const items = await listPending();
  return items.filter((item) => {
    const itemCaseId = String(item.caseId || item.payload?.case_id || "").trim().toLowerCase();
    const itemCaseNum = String(item.caseNumber || item.payload?.case_number || item.payload?.caseNumber || "").trim().toLowerCase();
    return (itemCaseId && itemCaseId === key) || (itemCaseNum && itemCaseNum === key);
  });
}

/**
 * WRITE-AHEAD: Save an entire stop (all deliveries and photos) in a SINGLE transaction
 * before ANY network POST is made.
 *
 * FAIL-OPEN PROTECTION: If IndexedDB is supported/exists and write-ahead transaction/open/read-back
 * fails for ANY reason, this function THROWS and NEVER falls back to in-memory storage.
 */
export async function saveStopDeliveriesToOutbox(
  deliveries: Array<{
    payload: Record<string, unknown>;
    photos?: Array<{ id?: string; imageData: string; timestamp?: string; position?: number }>;
  }>
): Promise<OutboxItem[]> {
  if (simulateQuotaError) {
    throw new StorageQuotaError("Simulated storage quota exceeded");
  }

  const now = new Date().toISOString();
  const createdItems: OutboxItem[] = [];
  const photosToStore: StoredPhoto[] = [];

  for (const delivery of deliveries) {
    const rawPayload = { ...delivery.payload };
    const id = String(rawPayload.id || newOfflineId());
    rawPayload.id = id;
    const eventId = String(rawPayload.event_id || rawPayload.eventId || id);
    const caseId = String(rawPayload.case_id || rawPayload.caseId || "");
    const caseNumber = String(rawPayload.case_number || rawPayload.caseNumber || "");
    const recipientId = String(rawPayload.recipient_id || rawPayload.recipientId || "");
    const personName = String(rawPayload.person_being_served || rawPayload.personEntityBeingServed || "");

    const photoIds: string[] = [];
    const photosFromDelivery: Array<{ id?: string; imageData: string; timestamp?: string; position?: number }> = [];

    if (delivery.photos && Array.isArray(delivery.photos)) {
      delivery.photos.forEach((ph, idx) => {
        const photoId = String(ph.id || `${id}_ph_${idx}`);
        photoIds.push(photoId);
        photosFromDelivery.push({
          id: photoId,
          position: typeof ph.position === "number" ? ph.position : idx + 1,
          imageData: ph.imageData,
          timestamp: ph.timestamp || now,
        });
        photosToStore.push({
          id: photoId,
          serveId: id,
          position: typeof ph.position === "number" ? ph.position : idx + 1,
          imageData: ph.imageData,
          timestamp: ph.timestamp || now,
        });
      });
    } else if (rawPayload.photos && Array.isArray(rawPayload.photos)) {
      (rawPayload.photos as any[]).forEach((ph, idx) => {
        const photoId = String(ph?.id || `${id}_ph_${idx}`);
        photoIds.push(photoId);
        const imgData = typeof ph === "string" ? ph : (ph.imageData || ph.image_data || "");
        photosFromDelivery.push({
          id: photoId,
          position: typeof ph?.position === "number" ? ph.position : idx + 1,
          imageData: imgData,
          timestamp: ph?.timestamp || now,
        });
        photosToStore.push({
          id: photoId,
          serveId: id,
          position: typeof ph?.position === "number" ? ph.position : idx + 1,
          imageData: imgData,
          timestamp: ph?.timestamp || now,
        });
      });
    } else if (rawPayload.imageData || rawPayload.image_data) {
      const imgData = String(rawPayload.imageData || rawPayload.image_data);
      const photoId = `${id}_ph_0`;
      photoIds.push(photoId);
      photosFromDelivery.push({
        id: photoId,
        position: 1,
        imageData: imgData,
        timestamp: now,
      });
      photosToStore.push({
        id: photoId,
        serveId: id,
        position: 1,
        imageData: imgData,
        timestamp: now,
      });
    }

    // Compute canonical fingerprint BEFORE stripping full photo bytes
    const fingerprint = computePayloadFingerprint({
      ...rawPayload,
      photos: photosFromDelivery.length > 0 ? photosFromDelivery : undefined,
    });

    // Strip full photo bytes from item.payload to prevent duplicate storage
    const trimmedPayload = { ...rawPayload };
    delete trimmedPayload.imageData;
    delete trimmedPayload.image_data;
    if (photosFromDelivery.length > 0) {
      trimmedPayload.photos = photosFromDelivery.map((p) => ({
        id: p.id,
        position: p.position,
        timestamp: p.timestamp,
      }));
    } else {
      delete trimmedPayload.photos;
    }

    const item: OutboxItem = {
      id,
      eventId,
      caseId,
      caseNumber,
      recipientId,
      personName,
      state: "pending",
      fingerprint,
      attempts: 0,
      createdAt: String(rawPayload.occurred_at || rawPayload.timestamp || now),
      updatedAt: now,
      payload: trimmedPayload,
      photoIds: photoIds.length > 0 ? photoIds : undefined,
    };
    createdItems.push(item);
  }

  // Memory store is strictly for test runners / environments where IndexedDB does not exist
  if (!hasIndexedDB()) {
    for (const ph of photosToStore) memPhotos.set(ph.id, ph);
    for (const item of createdItems) memItems.set(item.id, item);
    notify(Array.from(memItems.values()));
    return createdItems;
  }

  // FAIL-OPEN IndexedDB write: any open/tx/read-back failure throws directly
  const db = await openDb();
  try {
    if (simulateTxError) {
      throw new Error("Simulated transaction abort failure");
    }

    const tx = db.transaction([STORE_PENDING, STORE_PHOTOS], "readwrite");
    const pendingStore = tx.objectStore(STORE_PENDING);
    const photoStore = tx.objectStore(STORE_PHOTOS);

    for (const ph of photosToStore) {
      photoStore.put(ph);
    }
    for (const item of createdItems) {
      pendingStore.put(item);
    }

    await txDone(tx);

    // Read-back verification: assert every expected id is present in IndexedDB
    const readTx = db.transaction([STORE_PENDING, STORE_PHOTOS], "readonly");
    const readPending = readTx.objectStore(STORE_PENDING);
    const readPhotos = readTx.objectStore(STORE_PHOTOS);

    const pendingRequests = createdItems.map((item) => {
      return new Promise<void>((res, rej) => {
        if (simulateReadBackError) {
          rej(new Error(`Read-back assertion failed: item ${item.id} missing from IndexedDB`));
          return;
        }
        const r = readPending.get(item.id);
        r.onsuccess = () => {
          if (!r.result || (r.result as OutboxItem).id !== item.id) {
            rej(new Error(`Read-back assertion failed: item ${item.id} missing from IndexedDB`));
          } else {
            res();
          }
        };
        r.onerror = () => rej(r.error || new Error("Read-back get failed"));
      });
    });

    const photoRequests = photosToStore.map((ph) => {
      return new Promise<void>((res, rej) => {
        const r = readPhotos.get(ph.id);
        r.onsuccess = () => {
          if (!r.result || (r.result as StoredPhoto).id !== ph.id) {
            rej(new Error(`Read-back assertion failed: photo ${ph.id} missing from IndexedDB`));
          } else {
            res();
          }
        };
        r.onerror = () => rej(r.error || new Error("Read-back photo failed"));
      });
    });

    await Promise.all([...pendingRequests, ...photoRequests]);
    await txDone(readTx);
  } catch (err) {
    // If read-back or transaction assertion failed, purge unverified write batch to leave IDB clean
    try {
      const cleanupTx = db.transaction([STORE_PENDING, STORE_PHOTOS], "readwrite");
      const cPending = cleanupTx.objectStore(STORE_PENDING);
      const cPhotos = cleanupTx.objectStore(STORE_PHOTOS);
      for (const item of createdItems) cPending.delete(item.id);
      for (const ph of photosToStore) cPhotos.delete(ph.id);
      await txDone(cleanupTx);
    } catch {
      /* ignore cleanup error */
    }
    throw err;
  } finally {
    db.close();
  }

  notify(await listPending());
  return createdItems;
}

export async function enqueueServe(payload: Record<string, unknown>, lastError?: string): Promise<OutboxItem> {
  const photos = Array.isArray(payload.photos) ? (payload.photos as any) : undefined;
  const items = await saveStopDeliveriesToOutbox([{ payload, photos }]);
  const item = items[0];
  if (lastError && item) {
    item.lastError = lastError;
    await updateOutboxItem(item);
  }
  return item;
}

export async function updateOutboxItem(item: OutboxItem): Promise<void> {
  if (!hasIndexedDB()) {
    memItems.set(item.id, item);
    notify(Array.from(memItems.values()));
    return;
  }
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_PENDING, "readwrite");
    tx.objectStore(STORE_PENDING).put(item);
    await txDone(tx);
  } finally {
    db.close();
  }
  notify(await listPending());
}

/**
 * Remove an item and its associated photo blobs.
 * MUST only be invoked after verified sync or resolved skip removal.
 */
export async function removePending(id: string): Promise<void> {
  if (!hasIndexedDB()) {
    memItems.delete(id);
    for (const [k, v] of memPhotos.entries()) {
      if (v.serveId === id) memPhotos.delete(k);
    }
    notify(Array.from(memItems.values()));
    return;
  }
  const db = await openDb();
  try {
    // Find photo keys for this serveId
    const photoKeys = await new Promise<IDBValidKey[]>((res) => {
      try {
        const rTx = db.transaction(STORE_PHOTOS, "readonly");
        const store = rTx.objectStore(STORE_PHOTOS);
        const idx = store.index("serveId");
        const req = idx.getAllKeys(id);
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => res([]);
      } catch {
        res([]);
      }
    });

    const tx = db.transaction([STORE_PENDING, STORE_PHOTOS], "readwrite");
    tx.objectStore(STORE_PENDING).delete(id);
    const pStore = tx.objectStore(STORE_PHOTOS);
    for (const k of photoKeys) {
      pStore.delete(k);
    }
    await txDone(tx);
  } finally {
    db.close();
  }
  notify(await listPending());
}

// Cross-tab lock using Web Locks API with fallback
let inMemoryLock = false;

export async function withCrossTabLock<T>(fn: () => Promise<T>): Promise<T | null> {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    try {
      return await navigator.locks.request("servetracker-sync-lock", { ifAvailable: true }, async (lock) => {
        if (!lock) return null;
        return await fn();
      });
    } catch {
      // If Web Locks fails, fall through
    }
  }
  if (inMemoryLock) return null;
  inMemoryLock = true;
  try {
    return await fn();
  } finally {
    inMemoryLock = false;
  }
}

export interface SyncResult {
  id: string;
  state: OutboxState;
  item: OutboxItem;
  receipt?: ServerReceipt;
  error?: string;
}

export type PostFn = (payload: Record<string, unknown>) => Promise<any>;
export type ConfirmFn = (id: string, fingerprint: string) => Promise<{ status?: number; confirmed?: boolean; [k: string]: unknown }>;

let defaultPostFn: PostFn | null = null;
let defaultConfirmFn: ConfirmFn | null = null;

export function registerSyncHandlers(postFn: PostFn, confirmFn: ConfirmFn) {
  if (!confirmFn) {
    throw new Error("registerSyncHandlers requires a confirmation handler (confirmFn)");
  }
  defaultPostFn = postFn;
  defaultConfirmFn = confirmFn;
}

/**
 * Execute sync for a single outbox item against backend contracts.
 */
export async function syncItem(
  item: OutboxItem,
  postFn: PostFn,
  confirmFn: ConfirmFn,
  options?: { force?: boolean }
): Promise<SyncResult> {
  const force = options?.force ?? false;

  // Terminal or already-verified states
  if (item.state === "verified") {
    // 48-hour safety retention: prune only after 48 hours has elapsed
    const age = Date.now() - new Date(item.updatedAt || item.createdAt).getTime();
    if (age > 48 * 60 * 60 * 1000) {
      await removePending(item.id);
    }
    return { id: item.id, state: "verified", item };
  }
  if (item.state === "skipped") {
    return { id: item.id, state: "skipped", item, receipt: item.serverReceipt };
  }
  if (item.state === "blocked" && !force) {
    return { id: item.id, state: "blocked", item, error: item.lastError };
  }
  if (item.state === "conflict" && !force) {
    return { id: item.id, state: "conflict", item, error: item.lastError };
  }

  // Backoff check (exponential backoff + jitter, max 60s)
  if (!force && item.attempts > 0 && item.lastAttemptAt) {
    const elapsed = Date.now() - new Date(item.lastAttemptAt).getTime();
    const backoffMs = Math.min(1000 * Math.pow(2, Math.min(item.attempts, 6)), 60000);
    if (elapsed < backoffMs) {
      return { id: item.id, state: item.state, item };
    }
  }

  // If already posted but unverified, try confirmation directly
  if (item.state === "posted_unverified") {
    try {
      const conf = await confirmFn(item.id, item.fingerprint);
      const confStatus = typeof conf?.status === "number" ? conf.status : (conf?.confirmed ? 200 : undefined);

      if (confStatus === 200 || conf?.confirmed) {
        item.state = "verified";
        item.updatedAt = new Date().toISOString();
        await updateOutboxItem(item);
        // Retain verified items in IndexedDB for 48h safety window before unlinking
        return { id: item.id, state: "verified", item, receipt: item.serverReceipt };
      } else if (confStatus === 409 || conf?.error === "fingerprint_mismatch") {
        item.state = "conflict";
        item.lastError = `409 fingerprint_mismatch: ${String(conf?.message || "stored serve fingerprint does not match client fingerprint")}`;
        await updateOutboxItem(item);
        return { id: item.id, state: "conflict", item, error: item.lastError };
      } else if (confStatus === 403) {
        item.lastError = `Confirmation failed (HTTP 403): ${String(conf?.message || conf?.error || "forbidden")}`;
        await updateOutboxItem(item);
        return { id: item.id, state: "posted_unverified", item, receipt: item.serverReceipt };
      } else if (confStatus === 500) {
        item.lastError = `Confirmation failed (HTTP 500): ${String(conf?.message || conf?.error || "internal server error")}`;
        await updateOutboxItem(item);
        return { id: item.id, state: "posted_unverified", item, receipt: item.serverReceipt };
      } else if (confStatus === 404) {
        // Ghost confirmation detected (server rolled back or lost attempt): reset to pending to auto-recover
        item.state = "pending";
        item.lastError = "Server lost serve attempt (404); auto-recovering";
        await updateOutboxItem(item);
        return { id: item.id, state: "pending", item, receipt: item.serverReceipt };
      } else {
        item.lastError = `Confirmation unverified (HTTP ${confStatus || "unknown"}); retaining in outbox`;
        await updateOutboxItem(item);
        return { id: item.id, state: "posted_unverified", item, receipt: item.serverReceipt };
      }
    } catch (cErr: any) {
      const cStatus = typeof cErr?.status === "number" ? cErr.status : undefined;
      if (cStatus === 403) {
        item.lastError = `Confirmation failed (HTTP 403): ${cErr?.message || "forbidden"}`;
      } else if (cStatus === 500) {
        item.lastError = `Confirmation failed (HTTP 500): ${cErr?.message || "internal server error"}`;
      } else if (cStatus === 404) {
        item.lastError = "Confirmation failed (HTTP 404): serve attempt not found on server; retaining in outbox";
      } else if (isNetworkFailure(cErr)) {
        item.lastError = "Network error during confirmation; retaining unverified in outbox";
      } else {
        item.lastError = `Confirmation error: ${cErr instanceof Error ? cErr.message : String(cErr)}`;
      }
      await updateOutboxItem(item);
      return { id: item.id, state: "posted_unverified", item, receipt: item.serverReceipt };
    }
  }

  // Transition to posting
  item.state = "posting";
  item.attempts += 1;
  item.lastAttemptAt = new Date().toISOString();
  await updateOutboxItem(item);

  // Rehydrate full photo bytes before POST
  const rehydratedPayload = await rehydrateServePayload(item);
  const payload = {
    ...rehydratedPayload,
    id: item.id,
    sendEmail: item.payload.sendEmail !== false,
  };

  try {
    const res = await postFn(payload);

    // Skip response: already_served
    if (res && res.skipped === true) {
      item.state = "skipped";
      item.serverReceipt = res;
      item.lastError = undefined;
      await updateOutboxItem(item);
      return { id: item.id, state: "skipped", item, receipt: res };
    }

    // Normal commit success: transition to posted_unverified
    item.state = "posted_unverified";
    item.serverReceipt = res;
    await updateOutboxItem(item);

    // Now attempt confirmation GET
    try {
      const conf = await confirmFn(item.id, item.fingerprint);
      const confStatus = typeof conf?.status === "number" ? conf.status : (conf?.confirmed ? 200 : undefined);

      if (confStatus === 200 || conf?.confirmed) {
        item.state = "verified";
        item.updatedAt = new Date().toISOString();
        await updateOutboxItem(item);
        // Retain in IndexedDB for 48h safety window before unlinking
        return { id: item.id, state: "verified", item, receipt: res };
      } else if (confStatus === 409 || conf?.error === "fingerprint_mismatch") {
        item.state = "conflict";
        item.lastError = `409 fingerprint_mismatch: ${String(conf?.message || "stored serve fingerprint does not match client fingerprint")}`;
        await updateOutboxItem(item);
        return { id: item.id, state: "conflict", item, error: item.lastError };
      } else if (confStatus === 403) {
        item.lastError = `Confirmation failed (HTTP 403): ${String(conf?.message || conf?.error || "forbidden")}`;
        await updateOutboxItem(item);
        return { id: item.id, state: "posted_unverified", item, receipt: res };
      } else if (confStatus === 500) {
        item.lastError = `Confirmation failed (HTTP 500): ${String(conf?.message || conf?.error || "internal server error")}`;
        await updateOutboxItem(item);
        return { id: item.id, state: "posted_unverified", item, receipt: res };
      } else if (confStatus === 404) {
        item.lastError = "Confirmation failed (HTTP 404): serve attempt not found on server; retaining in outbox";
        await updateOutboxItem(item);
        return { id: item.id, state: "posted_unverified", item, receipt: res };
      } else {
        item.lastError = `Confirmation unverified (HTTP ${confStatus || "unknown"}); retaining in outbox`;
        await updateOutboxItem(item);
        return { id: item.id, state: "posted_unverified", item, receipt: res };
      }
    } catch (confErr: any) {
      const cStatus = typeof confErr?.status === "number" ? confErr.status : undefined;
      if (cStatus === 403) {
        item.lastError = `Confirmation failed (HTTP 403): ${confErr?.message || "forbidden"}`;
      } else if (cStatus === 500) {
        item.lastError = `Confirmation failed (HTTP 500): ${confErr?.message || "internal server error"}`;
      } else if (cStatus === 404) {
        item.lastError = "Confirmation failed (HTTP 404): serve attempt not found on server; retaining in outbox";
      } else if (isNetworkFailure(confErr)) {
        item.lastError = "Network drop during confirmation; retaining unverified in outbox";
      } else {
        item.lastError = `Confirmation error: ${confErr instanceof Error ? confErr.message : String(confErr)}`;
      }
      await updateOutboxItem(item);
      return { id: item.id, state: "posted_unverified", item, receipt: res };
    }
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err || "sync failed");
    // Classify errors strictly by attached HTTP status code, NEVER substring regex like 4000ms
    const status = typeof err?.status === "number" ? err.status : undefined;

    // 503 Archived pending restore
    if (status === 503) {
      item.state = "archived";
      item.lastError = "503 Service Archived: awaiting restore (retriable)";
      item.serverReceipt = { archived: true, committed: false, retry: true, serveId: item.id };
      await updateOutboxItem(item);
      return { id: item.id, state: "archived", item, error: item.lastError };
    }

    // 409 duplicate / id conflict
    if (status === 409) {
      item.state = "conflict";
      item.lastError = "409 id_conflict: serve ID exists with different data";
      await updateOutboxItem(item);
      return { id: item.id, state: "conflict", item, error: item.lastError };
    }

    // 400 / 403 Non-retriable client errors -> blocked
    if (status === 400 || status === 403) {
      item.state = "blocked";
      item.lastError = `HTTP ${status}: ${msg.slice(0, 240)}`;
      await updateOutboxItem(item);
      return { id: item.id, state: "blocked", item, error: item.lastError };
    }

    // Network failure or unknown error status -> revert to pending with backoff
    item.state = "pending";
    item.lastError = msg.slice(0, 240);
    await updateOutboxItem(item);
    return { id: item.id, state: "pending", item, error: item.lastError };
  }
}

/**
 * Unified sync function used by immediate submit, 30s timer, online, visibility, and manual retry.
 */
export async function syncOutbox(options?: {
  forceId?: string;
  forceAll?: boolean;
  targetIds?: string[];
  postFn?: PostFn;
  confirmFn?: ConfirmFn;
}): Promise<{ ok: number; fail: number; results: SyncResult[] }> {
  const pFn = options?.postFn || defaultPostFn;
  const cFn = options?.confirmFn || defaultConfirmFn;
  if (!cFn) {
    throw new Error("Sync handler not configured: confirmFn is required to verify persistence");
  }
  if (!pFn) {
    throw new Error("Sync handler not configured: postFn is required");
  }

  // Cross-tab lock check
  const lockResult = await withCrossTabLock(async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return { ok: 0, fail: 0, results: [] };
    }

    const items = await listPending();
    const results: SyncResult[] = [];
    let ok = 0;
    let fail = 0;

    for (const item of items) {
      if (options?.targetIds && !options.targetIds.includes(item.id)) continue;
      if (options?.forceId && item.id !== options.forceId) continue;

      const isForced = options?.forceAll || options?.forceId === item.id;
      const res = await syncItem(item, pFn, cFn, { force: isForced });
      results.push(res);

      if (res.state === "verified" || res.state === "skipped") {
        ok++;
      } else if (res.state === "blocked" || res.state === "conflict" || res.state === "archived") {
        fail++;
      } else if (res.state === "pending" && res.error) {
        fail++;
        if (isNetworkFailure(res.error)) {
          // Stop iterating further if network is dead
          break;
        }
      }
    }
    return { ok, fail, results };
  });

  return lockResult || { ok: 0, fail: 0, results: [] };
}

/**
 * Backward compatibility flushPending. Requires a real registered confirm handler.
 */
export async function flushPending(
  postFn: (payload: Record<string, unknown>) => Promise<unknown>
): Promise<{ ok: number; fail: number }> {
  if (!defaultConfirmFn) {
    throw new Error("Cannot flush outbox: confirmation handler is not configured");
  }
  const res = await syncOutbox({ postFn, confirmFn: defaultConfirmFn, forceAll: true });
  return { ok: res.ok, fail: res.fail };
}

let syncLoopStarted = false;

export function startOfflineSync(postFn: PostFn, confirmFn: ConfirmFn) {
  if (!confirmFn) {
    throw new Error("startOfflineSync requires a confirmation handler (confirmFn)");
  }
  registerSyncHandlers(postFn, confirmFn);

  if (syncLoopStarted || typeof window === "undefined") return;
  syncLoopStarted = true;

  const tick = () => {
    void syncOutbox().catch(() => {});
  };

  window.addEventListener("online", tick);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tick();
  });
  window.setInterval(tick, 30_000);
  window.setInterval(() => {
    void pruneExpiredOutbox().catch(() => {});
  }, 60 * 60 * 1000);
  tick();
}

/**
 * 48-Hour Outbox Pruner:
 * Silently deletes verified serve attempts and associated photos that are
 * older than maxAgeMs (default: 48 hours).
 * Unverified, pending, or conflict records are NEVER pruned.
 */
export async function pruneExpiredOutbox(maxAgeMs: number = 48 * 60 * 60 * 1000): Promise<number> {
  const items = await listPending();
  let pruned = 0;
  const now = Date.now();

  for (const item of items) {
    if (item.state === "verified" || item.state === "skipped") {
      const ts = new Date(item.updatedAt || item.createdAt).getTime();
      if (now - ts > maxAgeMs) {
        await removePending(item.id);
        pruned++;
      }
    }
  }

  return pruned;
}

/**
 * Reconciles the local 48-hour outbox against the server.
 * If Zo Computer rolled back to an older snapshot and is missing any serve,
 * resets those items to "pending" so syncOutbox automatically re-posts them.
 */
export async function reconcileOutboxWithServer(
  checkMissingFn: (ids: string[]) => Promise<{ missing_ids?: string[] }>
): Promise<{ checked: number; recovered: number }> {
  const items = await listPending();
  const now = Date.now();
  const recentItems = items.filter((item) => {
    const age = now - new Date(item.updatedAt || item.createdAt).getTime();
    return age <= 48 * 60 * 60 * 1000;
  });

  if (recentItems.length === 0) {
    return { checked: 0, recovered: 0 };
  }

  const idsToCheck = recentItems.map((i) => i.id);
  try {
    const res = await checkMissingFn(idsToCheck);
    const missing = new Set(res?.missing_ids || []);
    let recovered = 0;

    for (const item of recentItems) {
      if (missing.has(item.id)) {
        console.warn(`[OfflineOutbox] Reconcile detected missing serve ${item.id} on server; recovering to pending.`);
        item.state = "pending";
        item.lastError = "Server snapshot rollback detected; auto-recovering";
        await updateOutboxItem(item);
        recovered++;
      }
    }

    if (recovered > 0) {
      void syncOutbox().catch(() => {});
    }

    return { checked: idsToCheck.length, recovered };
  } catch (err) {
    console.warn("[OfflineOutbox] Reconcile check failed non-critically:", err);
    return { checked: idsToCheck.length, recovered: 0 };
  }
}

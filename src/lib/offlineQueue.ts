/**
 * Field offline queue: phone is a holding tank, server DB is source of truth.
 * Failed POST /api/serves payloads (including photos) stay in IndexedDB until
 * they land. Same local id is reused so a retry never creates a second row.
 */

const DB_NAME = "servetracker-offline";
const DB_VERSION = 1;
const STORE = "pending_serves";

export type PendingServe = {
  id: string;
  createdAt: string;
  payload: Record<string, unknown>;
  lastError?: string;
  attempts: number;
};

type Listener = (items: PendingServe[]) => void;
const listeners = new Set<Listener>();

function notify(items: PendingServe[]) {
  for (const fn of listeners) {
    try {
      fn(items);
    } catch {
      /* ignore */
    }
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB tx failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB tx aborted"));
  });
}

export function newOfflineId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `off_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
}

export async function listPending(): Promise<PendingServe[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const items = await new Promise<PendingServe[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result || []) as PendingServe[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  }
}

export async function enqueueServe(payload: Record<string, unknown>, lastError?: string): Promise<PendingServe> {
  const id = String(payload.id || newOfflineId());
  payload.id = id;
  const item: PendingServe = {
    id,
    createdAt: String(payload.queuedAt || new Date().toISOString()),
    payload,
    lastError,
    attempts: Number(payload._offlineAttempts || 0),
  };
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(item);
  await txDone(tx);
  db.close();
  notify(await listPending());
  return item;
}

export async function removePending(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(id);
  await txDone(tx);
  db.close();
  notify(await listPending());
}

export async function markAttempt(id: string, lastError: string): Promise<void> {
  const items = await listPending();
  const item = items.find((x) => x.id === id);
  if (!item) return;
  item.attempts += 1;
  item.lastError = lastError;
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(item);
  await txDone(tx);
  db.close();
  notify(await listPending());
}

export function subscribePending(fn: Listener): () => void {
  listeners.add(fn);
  void listPending().then(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function isNetworkFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || "");
  if (/Failed to fetch|NetworkError|network|offline|Load failed|TypeError: fetch/i.test(msg)) return true;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return false;
}

let flushing = false;

export async function flushPending(
  postFn: (payload: Record<string, unknown>) => Promise<unknown>
): Promise<{ ok: number; fail: number }> {
  if (flushing) return { ok: 0, fail: 0 };
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: 0, fail: 0 };
  flushing = true;
  let ok = 0;
  let fail = 0;
  try {
    const items = await listPending();
    for (const item of items) {
      try {
        const payload = { ...item.payload, id: item.id, sendEmail: item.payload.sendEmail !== false };
        await postFn(payload);
        await removePending(item.id);
        ok += 1;
      } catch (err) {
        fail += 1;
        const msg = err instanceof Error ? err.message : String(err || "sync failed");
        // 409 / already exists → treat as landed
        if (/already exists|UNIQUE|409/i.test(msg)) {
          await removePending(item.id);
          ok += 1;
          fail -= 1;
          continue;
        }
        await markAttempt(item.id, msg.slice(0, 240));
        if (isNetworkFailure(err)) break;
      }
    }
  } finally {
    flushing = false;
  }
  return { ok, fail };
}

let started = false;

export function startOfflineSync(postFn: (payload: Record<string, unknown>) => Promise<unknown>) {
  if (started || typeof window === "undefined") return;
  started = true;
  const tick = () => {
    void flushPending(postFn);
  };
  window.addEventListener("online", tick);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tick();
  });
  window.setInterval(tick, 30_000);
  tick();
}

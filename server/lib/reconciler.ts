import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { DATA_DIR, DB_PATH, UPLOADS_DIR, serveIsTombstoned, type Db } from "../db";
import {
  hotBufferTmpDir,
  downloadArchive,
  hasTombstone,
  listArchiveKeys,
  localPhotoPath,
  tombstoneKeyForServe,
} from "./hotBuffer";

const LOCK_TIMEOUT_MS = 15000;
const STALE_LOCK_MS = 60000;

function getLockDirPath(): string {
  const base = existsSync("/dev/shm") ? "/dev/shm" : resolve(DATA_DIR);
  return join(base, "servetracker-reconcile.lock.d");
}

let inProcessLock: Promise<void> = Promise.resolve();

/**
 * Acquire shared cross-process and in-process reconcile lock.
 * Guaranteed atomic via OS mkdir on POSIX filesystems.
 */
export async function withReconcileLock<T>(fn: () => Promise<T>): Promise<T> {
  // Wait for in-process queue first
  let releaseInProcess: () => void = () => {};
  const currentLock = inProcessLock;
  inProcessLock = new Promise<void>((resolve) => {
    releaseInProcess = resolve;
  });
  await currentLock;

  const lockDir = getLockDirPath();
  const start = Date.now();
  let acquired = false;

  while (!acquired) {
    try {
      mkdirSync(lockDir);
      writeFileSync(
        join(lockDir, "info.json"),
        JSON.stringify({ pid: process.pid, time: Date.now() }) + "\n",
      );
      acquired = true;
    } catch (err: any) {
      if (err?.code === "EEXIST") {
        // Check for stale lock
        try {
          const infoPath = join(lockDir, "info.json");
          if (existsSync(infoPath)) {
            const raw = JSON.parse(readFileSync(infoPath, "utf8"));
            if (Date.now() - (raw.time || 0) > STALE_LOCK_MS) {
              // Only steal a lock whose owning process is actually gone. Stealing
              // from a live owner lets DELETE and the reconciler overlap, which
              // can resurrect a row that was just deleted. A lock left behind by
              // OUR OWN pid is abandoned (we cannot still be holding it), so it
              // must be stealable too, otherwise every later call times out.
              const lockPid = Number(raw.pid || 0);
              const ownerAlive =
                lockPid && lockPid !== process.pid
                  ? (() => {
                      try {
                        process.kill(lockPid, 0);
                        return true;
                      } catch {
                        return false;
                      }
                    })()
                  : false;
              if (!ownerAlive) {
                try { unlinkSync(infoPath); } catch {}
                try { rmdirSync(lockDir); } catch {}
                continue;
              }
            }
          }
        } catch {}

        if (Date.now() - start > LOCK_TIMEOUT_MS) {
          releaseInProcess();
          throw new Error(`Reconcile lock acquisition timed out after ${LOCK_TIMEOUT_MS}ms`);
        }
        await new Promise((r) => setTimeout(r, 50));
      } else {
        releaseInProcess();
        throw err;
      }
    }
  }

  try {
    return await fn();
  } finally {
    try {
      const infoPath = join(lockDir, "info.json");
      if (existsSync(infoPath)) unlinkSync(infoPath);
      if (existsSync(lockDir)) rmdirSync(lockDir);
    } catch {}
    releaseInProcess();
  }
}

export type ReconcileStats = {
  checked: number;
  recovered: number;
  skippedTombstoned: number;
  skippedExisting: number;
  errors: number;
};

/**
 * Single tracked, lock-aware reconciler used by boot and cron.
 * Restores missing serve attempts + photos transactionally from R2 archives
 * while strictly respecting off-box tombstones.
 */
export async function reconcileLostServes(
  dbInstance?: Db,
  helpers?: {
    renumberAttemptPeers?: (db: Db, scope: any) => void;
    recomputeRecipientAndCaseStatus?: (db: Db, caseId?: string | null, recipientId?: string | null) => void;
    invalidateExecutionsForCase?: (db: Db, caseId: string, reason: string) => void;
    logAuditEvent?: (db: Db, event: any) => void;
    checkpointWal?: (db: Db) => void;
    computePayloadFingerprint?: (input: any) => string;
  },
): Promise<ReconcileStats> {
  const stats: ReconcileStats = {
    checked: 0,
    recovered: 0,
    skippedTombstoned: 0,
    skippedExisting: 0,
    errors: 0,
  };

  return withReconcileLock(async () => {
    let keys: string[] = [];
    try {
      keys = await listArchiveKeys();
    } catch (err) {
      console.error("[Reconciler] Failed to list R2 archives (reconcile nonfatal):", err);
      return stats;
    }

    if (!keys || keys.length === 0) {
      return stats;
    }

    // Resolve db instance
    const ownsDb = !dbInstance;
    const db: Db = dbInstance || (new Database(resolve(DATA_DIR, DB_PATH)) as unknown as Db);

    try {
      for (const key of keys) {
        stats.checked++;
        const filename = key.split("/").pop() || "";
        // Defensive: never resurrect a test-suite artifact. Mock archives are
        // written as mock_<id>.zip and must never enter the real DB.
        if (filename.startsWith("mock_")) {
          stats.skippedExisting++;
          continue;
        }
        const serveId = filename.replace(/\.zip$/, "").trim();
        if (!serveId) continue;

        // Local tombstone is authoritative even if the R2 object is still uploading.
        if (serveIsTombstoned(db, serveId)) {
          stats.skippedTombstoned++;
          continue;
        }

        // 1. MUST check R2 tombstones first: NEVER restore tombstoned ID
        try {
          const tombstoned = await hasTombstone(serveId);
          if (tombstoned) {
            stats.skippedTombstoned++;
            console.log(`[Reconciler] Skipping tombstoned serve ${serveId} (permanent off-box delete)`);
            continue;
          }
        } catch (err) {
          console.error(`[Reconciler] Error checking tombstone for ${serveId}:`, err);
          stats.errors++;
          continue;
        }

        // 2. Check if already in SQLite
        const existing = db.query("SELECT id FROM serve_attempts WHERE id = ?").get(serveId);
        if (existing) {
          stats.skippedExisting++;
          continue;
        }

        // 3. Row missing from SQLite and NOT tombstoned → Recover from R2
        console.log(`[Reconciler] Recovering missing serve ${serveId} from ${key}...`);
        const tmpDir = hotBufferTmpDir();
        mkdirSync(tmpDir, { recursive: true });
        const tmpZip = join(tmpDir, `reconcile_${serveId}_${Date.now()}.zip`);
        const unpackDir = join(tmpDir, `unpack_${serveId}_${Date.now()}`);

        try {
          try {
            await downloadArchive(key, tmpZip);
          } catch (dlErr) {
            const msg = String(dlErr ?? "");
            if (msg.includes("404") || msg.includes("does not exist") || msg.includes("Not Found")) {
              stats.skippedExisting++;
              console.warn(`[Reconciler] archive vanished before download (already purged): ${key}`);
              continue;
            }
            throw dlErr;
          }

          const unpackScript = join(import.meta.dir, "..", "..", "scripts", "dualshield_unpack.py");
          const proc = Bun.spawn(["python3", unpackScript, tmpZip, unpackDir], {
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, stderr, code] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
          ]);

          if (code !== 0) {
            throw new Error(`Unpack failed: ${stderr || stdout}`);
          }

          const manifestPath = join(unpackDir, "manifest.json");
          if (!existsSync(manifestPath)) {
            throw new Error(`Archive ${key} missing manifest.json`);
          }

          const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
            serve: Record<string, unknown>;
            photos: Record<string, unknown>[];
          };

          const s = manifest.serve;
          const photos = manifest.photos || [];

          // Copy photo files into local UPLOADS_DIR
          const targetUploadsDir = resolve(process.env.DATA_DIR ? `${process.env.DATA_DIR}/uploads` : UPLOADS_DIR);
          mkdirSync(join(targetUploadsDir, "serves"), { recursive: true });

          const copyPhotoIfPresent = (imageUrl: unknown) => {
            if (!imageUrl || typeof imageUrl !== "string") return;
            const fname = imageUrl.split("/").pop();
            if (!fname) return;
            const srcInZip = join(unpackDir, "photos", fname);
            const destInUploads = join(targetUploadsDir, "serves", fname);
            if (existsSync(srcInZip) && !existsSync(destInUploads)) {
              Bun.write(destInUploads, Bun.file(srcInZip));
            }
          };

          copyPhotoIfPresent(s.image_url);
          for (const p of photos) {
            copyPhotoIfPresent(p.image_url);
          }

          // Compute payload fingerprint if missing
          let fingerprint = String(s.payload_fingerprint || "").trim();
          if (!fingerprint && helpers?.computePayloadFingerprint) {
            fingerprint = helpers.computePayloadFingerprint({ ...s, photos });
          }

          // Refuse to restore an orphan. If the parent case (or recipient) is gone,
          // the INSERT below dies on the FOREIGN KEY constraint and the archive is
          // re-downloaded on every pass: a permanent crash loop. Skip it cleanly and
          // leave the archive in R2 for manual review instead.
          const parentCaseId = s.case_id ? String(s.case_id) : "";
          if (parentCaseId) {
            const parentCase = db.query("SELECT id FROM client_cases WHERE id = ?").get(parentCaseId);
            if (!parentCase) {
              stats.errors++;
              console.warn(
                `[Reconciler] UNRESOLVABLE ${serveId}: parent case ${parentCaseId} is gone; ` +
                  `archive kept in R2 for manual review`,
              );
              continue;
            }
          }
          const parentRecipientId = s.recipient_id ? String(s.recipient_id) : "";
          if (parentRecipientId) {
            const parentRecipient = db.query("SELECT id FROM serve_recipients WHERE id = ?").get(parentRecipientId);
            if (!parentRecipient) {
              stats.errors++;
              console.warn(
                `[Reconciler] UNRESOLVABLE ${serveId}: parent recipient ${parentRecipientId} is gone; ` +
                  `archive kept in R2 for manual review`,
              );
              continue;
            }
          }

          if (serveIsTombstoned(db, serveId)) {
            stats.skippedTombstoned++;
            continue;
          }

          // Single SQLite transaction for attempt + photos + audit + renumber + recompute
          db.transaction(() => {
            db.query(
              `INSERT OR REPLACE INTO serve_attempts (
                id, client_id, client_name, case_number, case_name, recipient_id, person_being_served,
                status, notes, address, service_address, coordinates, image_url, image_file_id,
                thumbnail_url, thumbnail_file_id, image_data, timestamp, occurred_at, entered_at,
                attempt_number, attempt_type, gps_source, contact_person, is_manual, result_detail, physical_description, case_id,
                service_method, accepted_by, logged_by, logged_by_name, attempt_hash, accuracy_meters, device_info,
                posting_location, entity_name, recipient_title, event_id,
                payload_fingerprint, sync_version, committed_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              s.id || serveId,
              s.client_id || "",
              s.client_name || "",
              s.case_number || "",
              s.case_name || "",
              s.recipient_id || "",
              s.person_being_served || "",
              s.status || "completed",
              s.notes || "",
              s.address || "",
              s.service_address || s.address || "",
              s.coordinates || "",
              s.image_url || "",
              s.image_file_id || "",
              s.thumbnail_url || "",
              s.thumbnail_file_id || "",
              s.image_data || "",
              s.timestamp || "",
              s.occurred_at || s.timestamp || "",
              s.entered_at || "",
              s.attempt_number ?? 1,
              s.attempt_type || "physical",
              s.gps_source || "",
              s.contact_person || "",
              s.is_manual ? 1 : 0,
              s.result_detail || "",
              s.physical_description || "",
              s.case_id || "",
              s.service_method || "personal",
              s.accepted_by || "",
              s.logged_by || "system",
              s.logged_by_name || "System Reconciler",
              s.attempt_hash || "",
              s.accuracy_meters || null,
              s.device_info || "",
              s.posting_location || "",
              s.entity_name || "",
              s.recipient_title || "",
              s.event_id || "",
              fingerprint,
              s.sync_version ?? 1,
              s.committed_at || new Date().toISOString(),
            );

            // Photos
            db.query("DELETE FROM serve_attempt_photos WHERE serve_id = ?").run(serveId);
            for (const pr of photos) {
              db.query(
                `INSERT INTO serve_attempt_photos (id, serve_id, position, image_url, image_file_id, thumbnail_url, thumbnail_file_id, created_at, captured_at, label, coordinates)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).run(
                pr.id || `photo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                serveId,
                pr.position || 1,
                pr.image_url || "",
                pr.image_file_id || "",
                pr.thumbnail_url || "",
                pr.thumbnail_file_id || "",
                pr.created_at || new Date().toISOString(),
                pr.captured_at || "",
                pr.label || "",
                pr.coordinates || "",
              );
            }

            // Renumber
            if (helpers?.renumberAttemptPeers) {
              helpers.renumberAttemptPeers(db, {
                recipientId: s.recipient_id as string,
                caseId: s.case_id as string,
                clientId: s.client_id as string,
                caseNumber: s.case_number as string,
                personBeingServed: s.person_being_served as string,
              });
            }

            // Recompute recipient and case status
            if (helpers?.recomputeRecipientAndCaseStatus) {
              helpers.recomputeRecipientAndCaseStatus(db, s.case_id as string, s.recipient_id as string);
            }

            // Invalidate affected affidavit execution
            if (s.case_id && helpers?.invalidateExecutionsForCase) {
              helpers.invalidateExecutionsForCase(db, String(s.case_id), "reconcile_restore");
            }

            // Audit log: serve.reconciled
            if (helpers?.logAuditEvent) {
              helpers.logAuditEvent(db, {
                event_type: "serve.reconciled",
                actor_user_id: "system",
                actor_role: "system",
                target_resource_id: serveId,
                details: { source: "r2_reconcile", archive_key: key },
              });
            }
          })();

          if (helpers?.checkpointWal) {
            helpers.checkpointWal(db);
          }

          stats.recovered++;
          console.log(`[Reconciler] Successfully recovered serve ${serveId}`);
        } catch (recoverErr) {
          stats.errors++;
          console.error(`[Reconciler] Error recovering archive ${key}:`, recoverErr);
        } finally {
          try { unlinkSync(tmpZip); } catch {}
          try {
            const rmProc = Bun.spawn(["rm", "-rf", unpackDir]);
            await rmProc.exited;
          } catch {}
        }
      }
    } finally {
      if (ownsDb) {
        try { (db as any).close(); } catch {}
      }
    }

    return stats;
  });
}

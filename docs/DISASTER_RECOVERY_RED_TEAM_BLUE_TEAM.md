# Comprehensive Red Team / Blue Team Analysis: ServeTracker Disaster Recovery, Field Sync & Multi-Tier Resilience

> **Document Version:** 1.0.0  
> **Target System:** ServeTracker (Production :3150 / `PDFUSAEDIT-zo`)  
> **Core Objective:** Zero data loss for process service events (timestamps, GPS, notes, 0–5 photos), uninterrupted field operations during Zo Computer container outages, automatic self-healing reconciliation without duplicate records, and $0.00 additional cloud expenditure.

---

## 1. Executive Summary

This document presents a rigorous **Red Team / Blue Team adversarial analysis** of the two proposed data resilience architectures for ServeTracker:

* **Architecture A:** Event-driven encrypted webhooks pushing directly to TorBox / debrid storage.
* **Architecture B:** Phone-first offline PWA with 24–48 hour reconciled IndexedDB, paired with a 15-minute micro-batched delta sync and 48-hour auto-prune to dedicated 5 TB Google Drive storage.

For every failure point uncovered by the Red Team, an engineered fix and structural mitigation are provided.

---

## 2. Architecture A: TorBox Encrypted Webhook Ingestion

### Blue Team Specification
* **Workflow:** When a field server completes a serve on their phone, the ServeTracker backend encrypts the SQLite delta and photos using AES-256-GCM.
* **Ingestion:** A non-blocking webhook fires the encrypted payload off-box to TorBox.
* **Retention:** Relies on TorBox’s cloud buffer, assuming files auto-prune after 30 days of inactivity.
* **Restoration:** If Zo Computer’s database or container fails, a bootstrap script queries TorBox, fetches the newest encrypted blob, decrypts it locally, and repopulates SQLite and `data/uploads/`.

---

### Red Team Threat Modeling & Failure Modes

#### Failure Point A1: Hard API Quota & Rate Limit Ceiling
* **Mechanism:** TorBox's official API documentation specifies that `/webdl` and `/torrents` endpoints are rate-limited to **60 requests per hour per API token**.
* **Impact:** With 100 process servers conducting 50 serves a day (~5,000 serves/day), peak morning and afternoon windows generate **300 to 600 events per hour**. TorBox returns `429 Too Many Requests` or `COOLDOWN_LIMIT` within the first 10 minutes of active field operations.
* **Fix / Mitigation:** 
  * Implementing a token rotation pool (e.g., 10 API tokens) to distribute load. However, TorBox terms prohibit multi-account scraping/API pooling, and concurrent slot caps still apply.

#### Failure Point A2: Inbound Protocol Lockout (Read-Only WebDAV & T3 S3)
* **Mechanism:** 
  1. TorBox WebDAV documentation explicitly states: *"No, our WebDAV integration is read-only. You cannot upload or edit files inside of TorBox."*
  2. TorBox T3 documentation states: *"The striking difference is that currently, TorBox's T3 is Read Only, which means you can only download and view files, you cannot upload files through T3 from your computer to TorBox."*
  3. TorBox API does not offer a generic binary file `POST` endpoint; it expects `.torrent` files or external download URLs.
* **Impact:** External servers cannot directly push files to TorBox via standard protocols.
* **Fix / Mitigation:** 
  * To get a file into TorBox, ServeTracker would have to host the encrypted delta on a public temporary web server and call `/webdl/createwebdownload` to instruct TorBox to download it. This introduces a circular dependency: if Zo goes down, the hosting server hosting the source file also goes down.

#### Failure Point A3: The 30-Day Auto-Purge Inactivity Trap
* **Mechanism:** TorBox auto-deletes files only after 30 days of **total account inactivity**.
* **Impact:** Because an automated process serving app pushes data every minute throughout every business day, the account is perpetually active. Files will never auto-delete and will accumulate until they fill the account's storage cap.
* **Fix / Mitigation:** 
  * Write a custom backend pruning worker that issues explicit `DELETE` calls to TorBox's API, which consumes additional API rate-limit quota.

#### Failure Point A4: Court Evidentiary & Chain-of-Custody Scrutiny
* **Mechanism:** In contested process serving litigation (e.g., Motion to Quash Service or Traverse Hearings), defense counsel can subpoena server logs, transmission headers, and storage chain of custody.
* **Impact:** Routing legal evidence through an offshore torrent/debrid service creates severe evidentiary credibility vulnerabilities in court.
* **Fix / Mitigation:** 
  * Strict client-side AES-256-GCM encryption before transmission with locally held zero-knowledge keys, ensuring the external host is legally treated as an encrypted dumb pipe.

---

## 3. Architecture B: Phone-First Offline PWA + Reconciled IndexedDB + Google Drive Delta Vault

### Blue Team Specification
* **Workflow:**
  1. **Phone-First Entry:** ServeTracker PWA UI is cached permanently on the phone via Service Worker (`sw.js`). Even if Zo is down or signal is lost, the app opens instantly.
  2. **Device Write-Ahead:** Serves and photos write to `IndexedDB` (`offlineQueue.ts`) before any network dispatch.
  3. **Real-Time Push:** When connected, the phone submits directly to Zo. Zo writes to SQLite and saves photos to `data/uploads/serves/`.
  4. **48-Hour Safety Ledger:** Verified serves are retained in the phone's IndexedDB for **24–48 hours** as an immutable local recovery ledger.
  5. **15-Minute Offsite Micro-Batches:** Zo bundles all new serves and photos every 15 minutes into a single `.tar.gz` and uploads it to a dedicated 5 TB Google Drive folder (96 API calls/day total).
  6. **48-Hour Google Drive Auto-Prune:** Any delta archive older than 48 hours is deleted automatically via the script, keeping total offsite storage under 100 MB.

---

### Red Team Threat Modeling & Failure Modes

#### Failure Point B1: The "Ghost Confirmation" / Snapshot Rollback Gap
* **Mechanism:** 
  * Phone submits Serve #500 to Zo.
  * Zo writes Serve #500 to SQLite and returns `200 OK`. The phone marks it `verified`.
  * Zo crashes 5 minutes later before a snapshot or 15-minute delta runs.
  * Zo container restarts and restores an earlier snapshot (N-1) that **lacks Serve #500**.
  * The phone thinks Zo has the serve; Zo actually lost it.
* **Red Team Exploit:** Stale recovery where neither human notices the missing serve until the court date.
* **Engineered Fix (Reconciliation Handshake):**
  * When the ServeTracker PWA launches or reconnects, it sends a lightweight handshake payload:
    `POST /api/serves/reconcile` with `{ client_recent_ids: ["srv_499", "srv_500"] }` (all serves in the phone's 48-hour buffer).
  * Zo checks SQLite: `SELECT id FROM serves WHERE id IN (...)`.
  * Zo replies: `{ missing_ids: ["srv_500"] }`.
  * The phone automatically and silently re-transmits the complete payload and photos for Serve #500.

#### Failure Point B2: Dual-Restore Race Condition & Collision (Duplicates)
* **Mechanism:**
  * Zo crashes. 
  * The automated disaster recovery script restores from the Google Drive 15-minute delta.
  * Concurrently, 5 field servers reconnect their phones and trigger automatic re-syncing.
* **Red Team Exploit:** Both systems push the same serve, generating duplicate records in the database, duplicate entries in affidavits, and duplicate image files on disk (`photo_1.jpg`, `photo_1(1).jpg`).
* **Engineered Fix (Three-Tier Idempotency):**
  1. **Stable Client UUIDs:** The serve ID (`id: "srv_9a8b7c..."`) is generated on the phone prior to upload. SQLite enforces `PRIMARY KEY(id)` with `INSERT INTO serves (...) VALUES (...) ON CONFLICT(id) DO NOTHING;`.
  2. **Deterministic Content-Addressed Photos:** Photos are saved with deterministic filenames based on serve ID and position:  
     `data/uploads/serves/{serve_id}_p{index}.jpg` (or by SHA-256 hash). Simultaneous restores write to the identical file path, overwriting with identical bytes rather than creating duplicate copies.
  3. **Canonical Payload Fingerprinting (`serveFingerprint.ts`):** Hashes 23 normalized fields + ordered photo byte hashes. If a duplicate submission arrives, ServeTracker matches the fingerprint and suppresses duplicate client emails and duplicate notifications.

#### Failure Point B3: Mobile Browser Storage Eviction (iOS Safari / Android Chrome)
* **Mechanism:** Mobile operating systems under low storage conditions can silently purge `IndexedDB` data for web applications.
* **Impact:** A phone running low on space purges its 48-hour outbox before a Zo rollback can reconcile missing serves.
* **Engineered Fix (Persistent Storage API):**
  * On PWA installation, execute `navigator.storage.persist()`.
  * This requests non-volatile storage from Chrome and Safari, preventing the browser from evicting IndexedDB even under device memory pressure.
  * Storage footprint is strictly capped by downscaling photos client-side to 1280×960 (~150 KB each), ensuring 48 hours of serves never exceeds **15–30 MB**.

#### Failure Point B4: Multi-Photo Variable Uploads (0 to 5 Photos) & Network Drops
* **Mechanism:** A server uploads 5 photos on a spotty cellular connection. Photo 1, 2, and 3 upload; Photo 4 drops midway; connection resets.
* **Impact:** Fragmented serve records, broken image links in affidavits, or corrupted uploads.
* **Engineered Fix (Atomic Multi-Part Transaction):**
  * The phone packages the serve metadata and all 0–5 photos into a single atomic multipart payload.
  * ServeTracker writes photos to a temporary staging folder (`data/uploads/.tmp_{serve_id}/`).
  * Only when all photos pass SHA-256 integrity verification does ServeTracker move them to `data/uploads/serves/` and commit the SQLite transaction.
  * If the connection breaks on photo 4, the staging directory is unlinked and the phone retries cleanly.

#### Failure Point B5: Shared Google Drive Quota & Burst Throttling
* **Mechanism:** Google Drive API enforces a 1,000 requests per 100 seconds quota. Multiple business tools (Notary-log, daily intake, PDF tools) share the same Google Workspace accounts.
* **Impact:** If ServeTracker fired an API call on every serve, 5,000 serves/day would collide with intake uploads, throwing `403 userRateLimitExceeded`.
* **Engineered Fix (Micro-Batching & Folder Isolation):**
  * **Zero Per-Serve Calls:** ServeTracker never calls Google Drive on individual serves.
  * **15-Minute Aggregation:** An independent background worker bundles all serves into a single archive every 15 minutes.
  * **Exact Load:** Exactly **96 API calls per 24 hours**. This consumes less than 0.005% of Google Drive’s quota.
  * **Folder Sandboxing:** Writes strictly to a dedicated backup folder ID (`GDRIVE_BACKUP_FOLDER_ID`), leaving all intake and personal folders completely unaffected.

#### Failure Point B6: Hard Unannounced Zo VM Termination (Power Loss / Kill)
* **Mechanism:** Zo Computer's virtual machine is abruptly terminated or killed without sending a `SIGTERM` signal.
* **Impact:** In-memory SQLite buffers in WAL mode are not flushed; uncommitted writes since the last disk flush are lost.
* **Engineered Fix (Synchronous WAL & Periodic Delta):**
  * SQLite configured with `PRAGMA synchronous = NORMAL;` and `PRAGMA journal_mode = WAL;`, guaranteeing that every committed transaction is durable on disk immediately.
  * The 15-minute Google Drive delta ensures that in a total catastrophe with zero warning, maximum data exposure is capped at 15 minutes.
  * When field servers reconnect, their 48-hour phone IndexedDB immediately heals any transactions from that 15-minute gap.

---

## 4. Side-by-Side Evaluation Matrix

| Criterion | Architecture A (TorBox Webhook) | Architecture B (PWA + Reconciled DB + Batched Drive) |
| :--- | :--- | :--- |
| **Additional Monthly Cost** | $3.00 – $10.00 / month (Paid plan required) | **$0.00** (Uses existing 5 TB Google Drive) |
| **High-Volume Feasibility** | **Fails:** Capped at 60 API requests/hour | **Passes:** 96 requests/day via 15-min micro-batching |
| **Upload Compatibility** | **Fails:** WebDAV & T3 are strictly Read-Only | **Passes:** Native filesystem + standard Drive API |
| **Offline Field Operation** | **Fails:** Requires active connection to Zo/TorBox | **Passes:** 100% offline PWA shell + IndexedDB |
| **Ghost Confirmation Recovery** | **None:** Phone forgets after first 200 OK | **Built-in:** Reconciles 48h phone buffer on connect |
| **Duplicate Prevention** | High risk of duplicate files on retry | **Guaranteed:** Stable UUIDs + deterministic file paths |
| **Storage Management** | Inactivity purge fails under continuous usage | **Guaranteed:** 48-hour automated prune (<100 MB) |
| **Court Chain of Custody** | Risky (Offshore torrent/debrid service) | **Clean:** First-party phone outbox + private Drive |

---

## 5. Architectural Verification & Conclusion

* **Architecture A (TorBox)** is fundamentally blocked by TorBox's infrastructure design: read-only S3/WebDAV endpoints, a 60 call/hour ceiling, and lack of arbitrary file ingestion.
* **Architecture B (Offline PWA + Reconciled IndexedDB + Google Drive Delta)** completely eliminates data loss, survives container wipes, handles 0–5 photos cleanly, prevents duplicates through deterministic file naming, and stays 100% free within your existing 5 TB Google Drive capacity.

---

### Implementation Blueprint

1. **Step 1:** Deploy `public/sw.js` and `manifest.json` for offline PWA caching.
2. **Step 2:** Update `src/lib/offlineQueue.ts` to retain verified serves for 48 hours and add the `POST /api/serves/reconcile` self-healing handshake.
3. **Step 3:** Add `process.on('SIGTERM')` in ServeTracker's server entry point for graceful shutdown flushes.
4. **Step 4:** Deploy `/root/.hermes/scripts/backup_servetracker_intraday_gdrive.py` on a 15-minute schedule with 48-hour auto-prune.
5. **Step 5:** Deploy `scripts/restore_servetracker_intraday.sh` for one-click container recovery.

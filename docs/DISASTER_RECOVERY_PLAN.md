# ServeTracker Disaster Recovery & Business Continuity Plan

**Document Version:** 2026.3  
**Effective Date:** August 22, 2026  
**Recovery Target (RTO):** < 15 Minutes  
**Data Loss Target (RPO):** < 24 Hours (Daily Snapshot)

---

## 1. Backup Architecture & Automation

ServeTracker uses a dual-destination, non-blocking backup strategy:

1. **Consistent Database Snapshotting:**
   - Database snapshots are created using SQLite's native `VACUUM INTO '/dest/path'`, ensuring write consistency without interrupting active transactions or locking the WAL file.
2. **Local Archive Store:**
   - Compressed archive (`.tar.gz`) stored locally in `/home/workspace/Documents/Backups/servetracker/` with SHA-256 integrity checksums.
   - 7-day rolling retention policy automatically purges stale local snapshots.
3. **Off-Site Cloud Replication:**
   - Uploads snapshot to an isolated Google Drive backup folder (`1ZB7XTSC_eD6m3F-6_yI2VP065cKEQzVq`).
   - Round-trip file integrity is verified using SHA-256 digests.

---

## 2. Emergency Recovery & Restoration Procedure

In the event of total server loss or database corruption, execute the following recovery protocol:

### Step 1: Obtain Latest Backup
From the local backup directory or Google Drive:
```bash
ls -lt /home/workspace/Documents/Backups/servetracker/servetracker-prod-backup-*.tar.gz | head -n 1
```

### Step 2: Verify Archive Checksum
```bash
sha256sum /home/workspace/Documents/Backups/servetracker/servetracker-prod-backup-YYYY-MM-DD_HHMMSS.tar.gz
```

### Step 3: Stop Production Process
```bash
supervisorctl -c /etc/zo/supervisord-user.conf stop servetracker-proc
```

### Step 4: Extract and Restore Database
```bash
tar -xzvf /home/workspace/Documents/Backups/servetracker/servetracker-prod-backup-YYYY-MM-DD_HHMMSS.tar.gz -C /tmp/restore/
cp /tmp/restore/pdfusaedit.db /home/workspace/Projects/PDFUSAEDIT-zo/data/pdfusaedit.db
if [ -d /tmp/restore/signatures ]; then
  cp -r /tmp/restore/signatures/* /home/workspace/Projects/PDFUSAEDIT-zo/data/signatures/
fi
```

### Step 5: Database Sanity Check
```bash
bun -e "import { Database } from 'bun:sqlite'; const db = new Database('/home/workspace/Projects/PDFUSAEDIT-zo/data/pdfusaedit.db'); console.log('Tables:', db.query('SELECT name FROM sqlite_master WHERE type=\'table\'').all().length);"
```

### Step 6: Restart & Probe
```bash
supervisorctl -c /etc/zo/supervisord-user.conf start servetracker-proc
curl -s http://127.0.0.1:3150/api/health
```

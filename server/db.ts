import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";

export const DATA_DIR = process.env.DATA_DIR || join(import.meta.dir, "..", "data");
export const UPLOADS_DIR = join(DATA_DIR, "uploads");
export const DB_PATH = join(DATA_DIR, "pdfusaedit.db");

export function ensureDataDirs() {
  mkdirSync(join(UPLOADS_DIR, "serves"), { recursive: true });
  mkdirSync(join(UPLOADS_DIR, "documents"), { recursive: true });
}

export function createDb() {
  ensureDataDirs();
  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  initSchema(db);
  runMigrations(db);
  return db;
}

function initSchema(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'server',
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT DEFAULT '',
      additional_emails TEXT DEFAULT '[]',
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS client_cases (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      case_number TEXT NOT NULL,
      case_name TEXT DEFAULT '',
      court_name TEXT DEFAULT '',
      plaintiff_petitioner TEXT DEFAULT '',
      defendant_respondent TEXT DEFAULT '',
      home_address TEXT DEFAULT '',
      work_address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      status TEXT DEFAULT 'Open',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS serve_attempts (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      client_name TEXT DEFAULT '',
      case_number TEXT DEFAULT '',
      case_name TEXT DEFAULT '',
      status TEXT DEFAULT 'unknown',
      notes TEXT DEFAULT '',
      address TEXT DEFAULT '',
      service_address TEXT DEFAULT '',
      coordinates TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      image_file_id TEXT DEFAULT '',
      thumbnail_url TEXT DEFAULT '',
      thumbnail_file_id TEXT DEFAULT '',
      image_data TEXT DEFAULT '',
      timestamp TEXT NOT NULL,
      attempt_number INTEGER DEFAULT 1,
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );

    CREATE TABLE IF NOT EXISTS client_documents (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      case_id TEXT DEFAULT '',
      case_number TEXT DEFAULT '',
      file_name TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      file_type TEXT DEFAULT '',
      file_path TEXT NOT NULL,
      file_hash TEXT DEFAULT '',
      gdrive_file_id TEXT DEFAULT '',
      gdrive_synced_at TEXT DEFAULT '',
      is_archived INTEGER DEFAULT 0,
      archived_at TEXT DEFAULT '',
      description TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cases_client ON client_cases(client_id);
    CREATE INDEX IF NOT EXISTS idx_serves_client ON serve_attempts(client_id);
    CREATE INDEX IF NOT EXISTS idx_serves_timestamp ON serve_attempts(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_documents_client ON client_documents(client_id);

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT DEFAULT '',
      role TEXT DEFAULT 'admin',
      username TEXT DEFAULT '',
      display_name TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

    -- New Feature Tables
    CREATE TABLE IF NOT EXISTS serve_recipients (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT DEFAULT '',
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'Pending',
      home_address TEXT DEFAULT '',
      work_address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT,
      FOREIGN KEY (case_id) REFERENCES client_cases(id) ON DELETE CASCADE,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_recipients_case ON serve_recipients(case_id);
    CREATE INDEX IF NOT EXISTS idx_recipients_client ON serve_recipients(client_id);
    CREATE INDEX IF NOT EXISTS idx_recipients_name ON serve_recipients(full_name COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS serve_attempt_photos (
      id TEXT PRIMARY KEY,
      serve_id TEXT NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 1 AND position <= 5),
      image_url TEXT NOT NULL,
      image_file_id TEXT DEFAULT '',
      thumbnail_url TEXT DEFAULT '',
      thumbnail_file_id TEXT DEFAULT '',
      mime_type TEXT DEFAULT 'image/jpeg',
      width INTEGER DEFAULT 0,
      height INTEGER DEFAULT 0,
      file_size INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      captured_at TEXT DEFAULT '',
      label TEXT DEFAULT '',
      coordinates TEXT DEFAULT '',
      FOREIGN KEY (serve_id) REFERENCES serve_attempts(id) ON DELETE CASCADE,
      UNIQUE(serve_id, position)
    );

    CREATE INDEX IF NOT EXISTS idx_photos_serve ON serve_attempt_photos(serve_id, position);

    CREATE TABLE IF NOT EXISTS serve_attempt_edits (
      id TEXT PRIMARY KEY,
      serve_id TEXT NOT NULL,
      edited_at TEXT NOT NULL,
      edited_by TEXT DEFAULT 'user',
      old_notes TEXT,
      new_notes TEXT,
      old_status TEXT,
      new_status TEXT,
      FOREIGN KEY (serve_id) REFERENCES serve_attempts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      code_hash TEXT DEFAULT '',
      expires_at TEXT NOT NULL,
      used_at TEXT DEFAULT '',
      ip_address TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_reset_token_hash ON password_reset_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_reset_user_id ON password_reset_tokens(user_id);
  `);
}

function runMigrations(db: Database) {
  // 1. Users table verification
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'server',
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE);
  `);

  // 2. Check existing columns on sessions
  const sessionCols = db.query("PRAGMA table_info(sessions)").all() as { name: string }[];
  const sessionColNames = new Set(sessionCols.map((c) => c.name));
  if (!sessionColNames.has("user_id")) {
    db.exec("ALTER TABLE sessions ADD COLUMN user_id TEXT DEFAULT '';");
  }
  if (!sessionColNames.has("role")) {
    db.exec("ALTER TABLE sessions ADD COLUMN role TEXT DEFAULT 'admin';");
  }
  if (!sessionColNames.has("username")) {
    db.exec("ALTER TABLE sessions ADD COLUMN username TEXT DEFAULT '';");
  }
  if (!sessionColNames.has("display_name")) {
    db.exec("ALTER TABLE sessions ADD COLUMN display_name TEXT DEFAULT '';");
  }

  // 3. Check existing columns on serve_attempts
  const cols = db.query("PRAGMA table_info(serve_attempts)").all() as { name: string }[];
  const colNames = new Set(cols.map((c) => c.name));

  const addCol = (colName: string, sqlDef: string) => {
    if (!colNames.has(colName)) {
      db.exec(`ALTER TABLE serve_attempts ADD COLUMN ${colName} ${sqlDef};`);
    }
  };

  addCol("recipient_id", "TEXT DEFAULT ''");
  addCol("case_id", "TEXT DEFAULT ''");
  addCol("person_being_served", "TEXT DEFAULT ''");
  addCol("attempt_type", "TEXT DEFAULT 'physical'");
  addCol("occurred_at", "TEXT");
  addCol("entered_at", "TEXT");
  addCol("gps_source", "TEXT DEFAULT 'captured'");
  addCol("contact_person", "TEXT DEFAULT ''");
  addCol("is_manual", "INTEGER DEFAULT 0");
  addCol("result_detail", "TEXT DEFAULT ''");
  addCol("physical_description", "TEXT DEFAULT ''");
  addCol("service_method", "TEXT DEFAULT ''");
  addCol("accepted_by", "TEXT DEFAULT ''");
  addCol("posting_location", "TEXT DEFAULT ''");
  addCol("entity_name", "TEXT DEFAULT ''");
  addCol("recipient_title", "TEXT DEFAULT ''");
  addCol("logged_by", "TEXT DEFAULT ''");
  addCol("logged_by_name", "TEXT DEFAULT ''");
  db.exec("CREATE INDEX IF NOT EXISTS idx_serves_case ON serve_attempts(case_id);");

  // Backfill occurred_at and entered_at for older rows
  db.exec(`
    UPDATE serve_attempts 
    SET occurred_at = timestamp 
    WHERE occurred_at IS NULL OR occurred_at = '';
    
    UPDATE serve_attempts 
    SET entered_at = timestamp 
    WHERE entered_at IS NULL OR entered_at = '';
  `);

  // Safe backfill only: use THIS attempt's case_name when PBS is blank.
  db.exec(`
    UPDATE serve_attempts 
    SET person_being_served = case_name 
    WHERE (person_being_served IS NULL OR person_being_served = '')
      AND case_name IS NOT NULL AND case_name != '';
  `);

  // 4. Case columns (documents_to_serve, assigned_to, assigned_name)
  const caseCols = db.query("PRAGMA table_info(client_cases)").all() as { name: string }[];
  const caseColNames = new Set(caseCols.map((c) => c.name));
  if (!caseColNames.has("documents_to_serve")) {
    db.exec(`ALTER TABLE client_cases ADD COLUMN documents_to_serve TEXT DEFAULT '';`);
  }
  if (!caseColNames.has("assigned_to")) {
    db.exec(`ALTER TABLE client_cases ADD COLUMN assigned_to TEXT DEFAULT '';`);
  }
  if (!caseColNames.has("assigned_name")) {
    db.exec(`ALTER TABLE client_cases ADD COLUMN assigned_name TEXT DEFAULT '';`);
  }
  if (!caseColNames.has("service_requirements")) {
    db.exec(`ALTER TABLE client_cases ADD COLUMN service_requirements TEXT DEFAULT '';`);
  }
  if (!caseColNames.has("contact_info")) {
    db.exec(`ALTER TABLE client_cases ADD COLUMN contact_info TEXT DEFAULT '';`);
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_cases_assigned ON client_cases(assigned_to);");

  // 5. Serve recipients assigned columns
  const recCols = db.query("PRAGMA table_info(serve_recipients)").all() as { name: string }[];
  const recColNames = new Set(recCols.map((c) => c.name));
  if (!recColNames.has("assigned_to")) {
    db.exec(`ALTER TABLE serve_recipients ADD COLUMN assigned_to TEXT DEFAULT '';`);
  }
  if (!recColNames.has("assigned_name")) {
    db.exec(`ALTER TABLE serve_recipients ADD COLUMN assigned_name TEXT DEFAULT '';`);
  }

  // 6. Photo columns
  const photoCols = db.query("PRAGMA table_info(serve_attempt_photos)").all() as { name: string }[];
  const photoColNames = new Set(photoCols.map((c) => c.name));
  if (!photoColNames.has("captured_at")) {
    db.exec(`ALTER TABLE serve_attempt_photos ADD COLUMN captured_at TEXT DEFAULT '';`);
  }
  if (!photoColNames.has("label")) {
    db.exec(`ALTER TABLE serve_attempt_photos ADD COLUMN label TEXT DEFAULT '';`);
  }
  if (!photoColNames.has("coordinates")) {
    db.exec(`ALTER TABLE serve_attempt_photos ADD COLUMN coordinates TEXT DEFAULT '';`);
  }
  db.exec(`
    UPDATE serve_attempt_photos
    SET captured_at = created_at
    WHERE captured_at IS NULL OR captured_at = '';
    UPDATE serve_attempt_photos
    SET label = 'ServeTracker Photo ' || position
    WHERE label IS NULL OR label = '';
  `);

  const recipientCount = (db.query("SELECT COUNT(*) as count FROM serve_recipients").get() as { count: number }).count;
  if (recipientCount === 0) {
    const cases = db.query("SELECT id, client_id, defendant_respondent, home_address, work_address, created_at FROM client_cases").all() as {
      id: string;
      client_id: string;
      defendant_respondent: string;
      home_address: string;
      work_address: string;
      created_at: string;
    }[];

    for (const c of cases) {
      if (c.defendant_respondent && c.defendant_respondent.trim()) {
        const id = "rec_" + c.id.slice(0, 16);
        db.query(`
          INSERT OR IGNORE INTO serve_recipients (id, case_id, client_id, full_name, role, home_address, work_address, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          c.id,
          c.client_id,
          c.defendant_respondent.trim(),
          "Defendant / Respondent",
          c.home_address || "",
          c.work_address || "",
          c.created_at,
          c.created_at
        );
      }
    }
  }

  // 7. Seed Admin User if none exists
  const adminCount = (db.query("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get() as { count: number }).count;
  if (adminCount === 0) {
    const adminPass = process.env.APP_PASSWORD || "Password";
    const pwdHash = Bun.password.hashSync(adminPass, { algorithm: "argon2id" });
    const ts = new Date().toISOString();
    db.query(`
      INSERT OR IGNORE INTO users (id, username, password_hash, display_name, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run("usr_admin_default", "admin", pwdHash, "Admin", "admin", ts, ts);
  }

  // 8. Field-server profile columns (idempotent, additive)
  const userCols = db.query("PRAGMA table_info(users)").all() as { name: string }[];
  const userColNames = new Set(userCols.map((c) => c.name));
  const addUserCol = (colName: string, sqlDef: string) => {
    if (!userColNames.has(colName)) {
      db.exec(`ALTER TABLE users ADD COLUMN ${colName} ${sqlDef};`);
    }
  };
  addUserCol("email", "TEXT DEFAULT ''");
  addUserCol("phone", "TEXT DEFAULT ''");
  addUserCol("legal_name", "TEXT DEFAULT ''");
  addUserCol("license_number", "TEXT DEFAULT ''");
  addUserCol("license_jurisdiction", "TEXT DEFAULT ''");
  addUserCol("license_expires_at", "TEXT DEFAULT ''");
  addUserCol("service_territory_json", "TEXT DEFAULT '[]'");
  addUserCol("onboarding_status", "TEXT DEFAULT 'pending'");
  addUserCol("must_change_password", "INTEGER DEFAULT 1");
  addUserCol("profile_notes", "TEXT DEFAULT ''");
  addUserCol("signature_asset_id", "TEXT DEFAULT ''");
  addUserCol("signature_updated_at", "TEXT DEFAULT ''");
  addUserCol("last_login_at", "TEXT DEFAULT ''");
  addUserCol("last_activity_at", "TEXT DEFAULT ''");

  // Backfill: only unset onboarding — never clobber an explicit must_change_password=1.
  db.exec(`
    UPDATE users SET onboarding_status = 'active'
    WHERE role = 'admin' AND (onboarding_status = '' OR onboarding_status IS NULL OR onboarding_status = 'pending');
  `);

  // 9. New feature tables: signature assets, assignment events, affidavit executions
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_signature_assets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      width INTEGER DEFAULT 0,
      height INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revoked_at TEXT DEFAULT '',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS case_assignment_events (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      previous_server_id TEXT DEFAULT '',
      new_server_id TEXT DEFAULT '',
      actor_user_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      note TEXT DEFAULT '',
      FOREIGN KEY (case_id) REFERENCES client_cases(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS affidavit_executions (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      assigned_server_id TEXT NOT NULL,
      signed_by_user_id TEXT NOT NULL,
      applied_by_user_id TEXT NOT NULL,
      application_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      source_snapshot_json TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      rendered_hash TEXT NOT NULL,
      supersedes_execution_id TEXT DEFAULT '',
      invalidated_at TEXT DEFAULT '',
      invalidation_reason TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      signed_at TEXT NOT NULL,
      finalized_at TEXT DEFAULT '',
      FOREIGN KEY (case_id) REFERENCES client_cases(id),
      FOREIGN KEY (assigned_server_id) REFERENCES users(id),
      FOREIGN KEY (signed_by_user_id) REFERENCES users(id),
      FOREIGN KEY (applied_by_user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_sig_user_status ON user_signature_assets(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_assign_events_case ON case_assignment_events(case_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_exec_case ON affidavit_executions(case_id, status, created_at DESC);

    -- 11. Push Notifications and In-App Inbox tables
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      platform TEXT DEFAULT 'unknown',
      user_agent TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal',
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      entity_type TEXT DEFAULT '',
      entity_id TEXT DEFAULT '',
      action_url TEXT DEFAULT '',
      read_at TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS watchdog_events (
      id TEXT PRIMARY KEY,
      watchdog_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      notified_at TEXT NOT NULL,
      UNIQUE(watchdog_type, entity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_notif_user_unread ON notifications(user_id, read_at);
  `);

  // 12. Client document case links and archival columns (idempotent)
  const docCols = (db.query("PRAGMA table_info(client_documents)").all() as { name: string }[]).map((c) => c.name);
  if (!docCols.includes("case_id")) {
    db.run("ALTER TABLE client_documents ADD COLUMN case_id TEXT DEFAULT ''");
  }
  if (!docCols.includes("file_hash")) {
    db.run("ALTER TABLE client_documents ADD COLUMN file_hash TEXT DEFAULT ''");
  }
  if (!docCols.includes("gdrive_file_id")) {
    db.run("ALTER TABLE client_documents ADD COLUMN gdrive_file_id TEXT DEFAULT ''");
  }
  if (!docCols.includes("gdrive_synced_at")) {
    db.run("ALTER TABLE client_documents ADD COLUMN gdrive_synced_at TEXT DEFAULT ''");
  }
  if (!docCols.includes("is_archived")) {
    db.run("ALTER TABLE client_documents ADD COLUMN is_archived INTEGER DEFAULT 0");
  }
  if (!docCols.includes("archived_at")) {
    db.run("ALTER TABLE client_documents ADD COLUMN archived_at TEXT DEFAULT ''");
  }
  db.run("CREATE INDEX IF NOT EXISTS idx_documents_case ON client_documents(case_id)");
  const sessCols = db.query("PRAGMA table_info(sessions)").all() as { name: string }[];
  const sessColNames = new Set(sessCols.map((c) => c.name));
  const addSessCol = (colName: string, sqlDef: string) => {
    if (!sessColNames.has(colName)) {
      db.exec(`ALTER TABLE sessions ADD COLUMN ${colName} ${sqlDef};`);
    }
  };
  addSessCol("session_id", "TEXT DEFAULT ''");
  addSessCol("last_seen_at", "TEXT DEFAULT ''");
  addSessCol("revoked_at", "TEXT DEFAULT ''");
  addSessCol("revoked_by_user_id", "TEXT DEFAULT ''");
  db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at, revoked_at);");

  addUserCol("tos_accepted_at", "TEXT DEFAULT ''");
  addUserCol("tos_version", "TEXT DEFAULT ''");
  addUserCol("tos_ip", "TEXT DEFAULT ''");
  addUserCol("dpa_accepted_at", "TEXT DEFAULT ''");
  addUserCol("dpa_version", "TEXT DEFAULT ''");

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_consents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      document_type TEXT NOT NULL,
      version TEXT NOT NULL,
      accepted_at TEXT NOT NULL,
      ip_address TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_consents_user ON user_consents(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_consents_type ON user_consents(document_type);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      actor_user_id TEXT DEFAULT '',
      actor_role TEXT DEFAULT '',
      target_resource_id TEXT DEFAULT '',
      ip_address TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      details TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_logs_event ON audit_logs(event_type);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
  `);

  const attemptCols = (db.query("PRAGMA table_info(serve_attempts)").all() as { name: string }[]).map((c) => c.name);
  if (!attemptCols.includes("attempt_hash")) {
    db.run("ALTER TABLE serve_attempts ADD COLUMN attempt_hash TEXT DEFAULT ''");
  }
  if (!attemptCols.includes("accuracy_meters")) {
    db.run("ALTER TABLE serve_attempts ADD COLUMN accuracy_meters REAL DEFAULT 0.0");
  }
  if (!attemptCols.includes("device_info")) {
    db.run("ALTER TABLE serve_attempts ADD COLUMN device_info TEXT DEFAULT ''");
  }

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_prevent_attempt_tampering
    BEFORE UPDATE OF coordinates, timestamp, service_address, client_id, attempt_number
    ON serve_attempts
    FOR EACH ROW
    WHEN (
      OLD.coordinates IS NOT NULL AND OLD.coordinates != '' AND
      (OLD.coordinates != NEW.coordinates OR OLD.timestamp != NEW.timestamp)
    )
    BEGIN
      SELECT RAISE(ABORT, 'EVIDENTIARY_INTEGRITY_VIOLATION: Attempt GPS coordinates and timestamp cannot be altered after submission.');
    END;
  `);

  db.exec("PRAGMA user_version = 5;");
}

export type Db = Database;

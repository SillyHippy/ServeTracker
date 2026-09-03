import { Database } from "bun:sqlite";
import { join } from "path";
import { DATA_DIR } from "./db";

export function initBetterAuthTables(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      emailVerified INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      role TEXT DEFAULT 'server',
      phone_number TEXT DEFAULT '',
      phone_sms_enabled INTEGER DEFAULT 1,
      license_number TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_email ON user(email);

    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expiresAt TEXT NOT NULL,
      ipAddress TEXT DEFAULT '',
      userAgent TEXT DEFAULT '',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_session_token ON session(token);
    CREATE INDEX IF NOT EXISTS idx_session_user ON session(userId);

    CREATE TABLE IF NOT EXISTS account (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      accountId TEXT NOT NULL,
      providerId TEXT NOT NULL,
      accessToken TEXT,
      refreshToken TEXT,
      idToken TEXT,
      accessTokenExpiresAt TEXT,
      refreshTokenExpiresAt TEXT,
      scope TEXT,
      password TEXT,
      issuer TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_account_user ON account(userId);
    CREATE INDEX IF NOT EXISTS idx_account_provider ON account(providerId, accountId);

    CREATE TABLE IF NOT EXISTS verification (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_verification_identifier ON verification(identifier);

    CREATE TABLE IF NOT EXISTS sms_logs (
      id TEXT PRIMARY KEY,
      remote_id TEXT DEFAULT '',
      user_id TEXT DEFAULT '',
      phone_number TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      error_message TEXT DEFAULT '',
      retry_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sms_logs_user ON sms_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_sms_logs_status ON sms_logs(status);
  `);
}

if (import.meta.main) {
  const db = new Database(join(DATA_DIR, "pdfusaedit.db"));
  initBetterAuthTables(db);
  console.log("BetterAuth + SMS tables initialized successfully");
}

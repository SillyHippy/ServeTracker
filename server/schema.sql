-- ServeTracker Initial SQLite / Cloudflare D1 Database Schema

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  additional_emails TEXT DEFAULT '[]',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
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
  documents_to_serve TEXT DEFAULT '',
  service_requirements TEXT DEFAULT '',
  contact_info TEXT DEFAULT '',
  assigned_to TEXT DEFAULT '',
  assigned_name TEXT DEFAULT '',
  status TEXT DEFAULT 'Open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS serve_recipients (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT DEFAULT 'Defendant / Respondent',
  home_address TEXT DEFAULT '',
  work_address TEXT DEFAULT '',
  assigned_to TEXT DEFAULT '',
  assigned_name TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES client_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS serve_attempts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  client_name TEXT DEFAULT '',
  case_number TEXT DEFAULT '',
  case_name TEXT DEFAULT '',
  case_id TEXT DEFAULT '',
  recipient_id TEXT DEFAULT '',
  status TEXT DEFAULT 'unknown',
  notes TEXT DEFAULT '',
  address TEXT DEFAULT '',
  service_address TEXT DEFAULT '',
  coordinates TEXT DEFAULT '',
  gps_source TEXT DEFAULT 'captured',
  attempt_type TEXT DEFAULT 'physical',
  service_method TEXT DEFAULT '',
  accepted_by TEXT DEFAULT '',
  is_manual INTEGER DEFAULT 0,
  result_detail TEXT DEFAULT '',
  physical_description TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  image_file_id TEXT DEFAULT '',
  thumbnail_url TEXT DEFAULT '',
  thumbnail_file_id TEXT DEFAULT '',
  image_data TEXT DEFAULT '',
  timestamp TEXT NOT NULL,
  occurred_at TEXT,
  entered_at TEXT,
  attempt_number INTEGER DEFAULT 1,
  logged_by TEXT DEFAULT '',
  logged_by_name TEXT DEFAULT '',
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'server',
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  onboarding_status TEXT DEFAULT 'pending',
  contact_phone TEXT DEFAULT '',
  contact_email TEXT DEFAULT '',
  service_territory TEXT DEFAULT '[]',
  license_number TEXT DEFAULT '',
  license_jurisdiction TEXT DEFAULT '',
  license_expiry TEXT DEFAULT '',
  profile_notes TEXT DEFAULT '',
  signature_asset_id TEXT DEFAULT '',
  signature_updated_at TEXT DEFAULT '',
  last_login_at TEXT DEFAULT '',
  last_activity_at TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT DEFAULT '',
  revoked_by_user_id TEXT DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  ip TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS affidavit_executions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  affidavit_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'signed_not_notarized',
  signer_user_id TEXT NOT NULL,
  signer_display_name TEXT NOT NULL,
  signer_role TEXT NOT NULL,
  signature_asset_id TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  snapshot_data TEXT NOT NULL,
  html_cache TEXT DEFAULT '',
  invalidation_reason TEXT DEFAULT '',
  invalidated_at TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES client_cases(id) ON DELETE CASCADE
);

-- Indices for rapid querying
CREATE INDEX IF NOT EXISTS idx_cases_client_id ON client_cases(client_id);
CREATE INDEX IF NOT EXISTS idx_cases_assigned ON client_cases(assigned_to);
CREATE INDEX IF NOT EXISTS idx_recipients_case ON serve_recipients(case_id);
CREATE INDEX IF NOT EXISTS idx_serves_case_id ON serve_attempts(case_id);
CREATE INDEX IF NOT EXISTS idx_serves_logged_by ON serve_attempts(logged_by);
CREATE INDEX IF NOT EXISTS idx_executions_case ON affidavit_executions(case_id);

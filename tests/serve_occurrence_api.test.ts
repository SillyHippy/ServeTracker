import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The repository .env contains a live APP_PASSWORD. Isolate before importing any server module.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'serve-occurrence-api-'));
process.env.APP_PASSWORD = 'isolated-test-admin';
process.env.PORT = '39992';
process.env.MOCK_EMAIL = 'true';
process.env.DISABLE_EMAIL = 'true';
process.env.HELCIM_MOCK = 'true';
process.env.HOTBUFFER_MOCK = 'true';
const { createDb } = await import('../server/db');
const { registerRoutes } = await import('../server/routes');
const { initAuth } = await import('../server/auth');
const { Hono } = await import('hono');
const db = createDb();
initAuth(db);
const app = new Hono();
registerRoutes(app, db);

// Server auth uses a real session token rather than an x-user-id header.
const { createHash } = await import('node:crypto');
const token = 'time-edit-test-token';
const tokenHash = createHash('sha256').update(token).digest('hex');
const now = new Date().toISOString();
db.query('INSERT INTO sessions(token_hash,user_id,role,username,display_name,created_at,expires_at) VALUES (?,?,?,?,?,?,?)')
  .run(tokenHash,'usr_admin_default','admin','admin','Admin',now,'2099-01-01T00:00:00.000Z');
db.query('UPDATE users SET must_change_password = 0 WHERE id = ?').run('usr_admin_default');
db.query('INSERT INTO clients(id,name,created_at) VALUES (?,?,?)').run('client-time','Test Client',now);
db.query('INSERT INTO client_cases(id,client_id,case_number,case_name,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
  .run('case-time','client-time','MOCK-TIME','Test Case','active',now,now);
const original = '2026-10-07T15:00:00.000Z';
const edited = '2026-10-06T13:15:00.000Z';
db.query('INSERT INTO serve_attempts(id,client_id,client_name,case_number,case_name,status,notes,coordinates,timestamp,occurred_at,entered_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  .run('serve-time','client-time','Test Client','MOCK-TIME','Test Case','failed','original','36,-95',original,original,original);
db.query('UPDATE serve_attempts SET case_id = ? WHERE id = ?').run('case-time','serve-time');
const executionSql = `INSERT INTO affidavit_executions(id,case_id,client_id,assigned_server_id,signed_by_user_id,applied_by_user_id,application_mode,status,source_snapshot_json,source_hash,rendered_hash,created_at,signed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`;
db.query(executionSql).run('execution-time','case-time','client-time','usr_admin_default','usr_admin_default','usr_admin_default','stored','signed_not_notarized','{"occurred_at":"2026-10-07T15:00:00.000Z"}','snapshot-hash','rendered-hash',now,now);

const put = (body: unknown) => app.request('/api/serves/serve-time', { method:'PUT', headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'}, body:JSON.stringify(body) });

test('time correction persists UTC, preserves entry/GPS, and audits old/new time and actor', async () => {
  const res = await put({occurredAt:edited});
  expect(res.status).toBe(200);
  const row = db.query('SELECT occurred_at,timestamp,entered_at,coordinates FROM serve_attempts WHERE id = ?').get('serve-time') as Record<string,string>;
  expect(row.occurred_at).toBe(edited);
  expect(row.timestamp).toBe(original);
  expect(row.entered_at).toBe(original);
  expect(row.coordinates).toBe('36,-95');
  const edit = db.query('SELECT edited_by,old_occurred_at,new_occurred_at FROM serve_attempt_edits WHERE serve_id = ?').get('serve-time') as Record<string,string>;
  expect(edit.edited_by).toBe('usr_admin_default');
  expect(edit.old_occurred_at).toBe(original);
  expect(edit.new_occurred_at).toBe(edited);
  const execution = db.query('SELECT status,invalidated_at,source_snapshot_json FROM affidavit_executions WHERE id = ?').get('execution-time') as Record<string,string>;
  expect(execution.invalidated_at).toBeTruthy();
  expect(execution.source_snapshot_json).toContain(original);
});

test('invalid time is rejected and a no-op does not create a second edit', async () => {
  const before = (db.query('SELECT count(*) AS n FROM serve_attempt_edits').get() as {n:number}).n;
  expect((await put({occurredAt:'not-a-date'})).status).toBe(400);
  expect((await put({occurredAt:edited})).status).toBe(200);
  const after = (db.query('SELECT count(*) AS n FROM serve_attempt_edits').get() as {n:number}).n;
  expect(after).toBe(before);
  const execution = db.query('SELECT source_snapshot_json FROM affidavit_executions WHERE id = ?').get('execution-time') as {source_snapshot_json:string};
  expect(execution.source_snapshot_json).toContain(original);
});

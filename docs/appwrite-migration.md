# Appwrite → SQLite migration

One-time import from Appwrite Cloud into local SQLite (`data/pdfusaedit.db`) and file storage (`data/uploads/`).

**Credentials:** All env values are committed for Zo deploy:

- [`.env.production`](../.env.production) — canonical production file (copy to `.env` before running)
- [`.env.example`](../.env.example) — same values, reference template
- [`.cursor/migration-credentials.md`](../.cursor/migration-credentials.md) — Appwrite-only quick reference

## Full environment block (app + migration)

```env
# App login
APP_PASSWORD=Password

# Email (Resend SMTP)
EMAIL_FROM=no-reply@justlegalsolutions.org
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASSWORD=[REDACTED]
RESEND_API_KEY=[REDACTED]

# Server (zosite.json published_port = 3150)
PORT=3150
NODE_ENV=production
DATA_DIR=./data

# Vite build (legacy Supabase compat — optional)
VITE_SUPABASE_URL=https://qdjdmicjzmpggctzjsrf.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkamRtaWNqem1wZ2djdHpqc3JmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI3MTAxODIsImV4cCI6MjA1ODI4NjE4Mn0.St9w_1cd-8yr0vsL6tYQ0MgiQJeqV7-fw6TIursi0I8

# Appwrite migration
APPWRITE_ENDPOINT=https://nyc.cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=67ff9afd003750551953
APPWRITE_API_KEY=your_appwrite_api_key
APPWRITE_DATABASE_ID=67eae6fe0020c6721531
APPWRITE_CLIENTS_COLLECTION_ID=67eae70e000c042112c8
APPWRITE_CLIENT_CASES_COLLECTION_ID=67eae98f0017c9503bee
APPWRITE_SERVE_ATTEMPTS_COLLECTION_ID=new_serve_attempts
APPWRITE_CLIENT_DOCUMENTS_COLLECTION_ID=67eaeaa900128f318514
APPWRITE_STORAGE_BUCKET_ID=67eaeb7700322d74597e
APPWRITE_THUMBNAIL_BUCKET_ID=68865532001e22527554
MIGRATE_FILES=true
```

## Prerequisites

- [Bun](https://bun.sh) installed
- Dependencies installed: `npm install` or `bun install`
- Appwrite API key with read access to the database and storage buckets
- Network access to `https://nyc.cloud.appwrite.io/v1`

## Environment variables

### App runtime (required in production)

| Variable | Required | Value | Description |
|----------|----------|-------|-------------|
| `APP_PASSWORD` | Yes | `Password` | Login password for the app |
| `EMAIL_FROM` | Yes | `no-reply@justlegalsolutions.org` | From address for outbound email |
| `SMTP_PASSWORD` | Yes | (see block) | Resend API key used as SMTP password |
| `RESEND_API_KEY` | Alias | (same as SMTP) | Alternative name accepted by `server/email.ts` |
| `SMTP_HOST` | No | `smtp.resend.com` | SMTP host |
| `SMTP_PORT` | No | `587` | SMTP port |
| `SMTP_USER` | No | `resend` | SMTP username |
| `PORT` | No | `3150` | Server port (matches `zosite.json`) |
| `NODE_ENV` | No | `production` | Enables production env validation |
| `DATA_DIR` | No | `./data` | SQLite DB and uploads directory |
| `CORS_ORIGIN` | No | — | Extra allowed origins (comma-separated). Zo domain is in server defaults. |
| `VITE_SUPABASE_URL` | No | (see block) | Build-time only; legacy compat layer |
| `VITE_SUPABASE_ANON_KEY` | No | (see block) | Build-time only; legacy compat layer |
| `VITE_API_URL` | No | — | Empty = same-origin API |

### Appwrite migration

| Variable | Required | Default (in script) | Description |
|----------|----------|---------------------|-------------|
| `APPWRITE_ENDPOINT` | No | `https://nyc.cloud.appwrite.io/v1` | Appwrite API base URL |
| `APPWRITE_PROJECT_ID` | No | `67ff9afd003750551953` | Appwrite project ID |
| `APPWRITE_API_KEY` | **Yes** | (see block above) | Server API key with database + storage read permissions |
| `APPWRITE_DATABASE_ID` | No | `67eae6fe0020c6721531` | Appwrite database containing collections |
| `APPWRITE_CLIENTS_COLLECTION_ID` | No | `67eae70e000c042112c8` | Clients collection |
| `APPWRITE_CLIENT_CASES_COLLECTION_ID` | No | `67eae98f0017c9503bee` | Client cases collection |
| `APPWRITE_SERVE_ATTEMPTS_COLLECTION_ID` | No | `new_serve_attempts` | Serve attempts collection |
| `APPWRITE_CLIENT_DOCUMENTS_COLLECTION_ID` | No | `67eaeaa900128f318514` | Client documents collection |
| `APPWRITE_STORAGE_BUCKET_ID` | No | `67eaeb7700322d74597e` | Primary bucket (serve images, documents) |
| `APPWRITE_THUMBNAIL_BUCKET_ID` | No | `68865532001e22527554` | Thumbnail bucket |
| `MIGRATE_FILES` | No | `true` | Set to `false` to skip storage downloads |

Script defaults match this project's Appwrite setup. Override only if your Appwrite resources differ.

## How to run

### Option A — use committed `.env.production` (recommended on Zo)

```bash
cp .env.production .env
npm run migrate:appwrite
```

### Option B — inline env vars (PowerShell)

```powershell
$env:APPWRITE_API_KEY="standard_1c1f1462829d9a687e3ac8a46caa1e0393978081843f0ec0feecf8f7bc569f17a5bdfe60ff2d790e51131120187e14b051d250406610923016568b5d590db100a64c85e83510a7292604b1801788f8cd87e5bb209d7c27f393c37dd4ab3c3ac0cbd4d93611d23c6d1d7fc7eca3627f6bcf03d5173ceed57224f96d95bdd0a22b"
$env:MIGRATE_FILES="true"
npm run migrate:appwrite
```

### Option C — direct script invocation

```bash
bun scripts/migrate-from-appwrite.ts
```

Equivalent to `npm run migrate:appwrite`.

## What the migration pulls

The script `scripts/migrate-from-appwrite.ts` imports **all four collections** and **both storage buckets** when `MIGRATE_FILES=true`:

| Appwrite source | SQLite table | Files |
|-----------------|--------------|-------|
| `clients` collection | `clients` | — |
| `client_cases` collection | `client_cases` | — |
| `serve_attempts` collection | `serve_attempts` | Full images from `APPWRITE_STORAGE_BUCKET_ID`; thumbnails from `APPWRITE_THUMBNAIL_BUCKET_ID` → `data/uploads/serves/` |
| `client_documents` collection | `client_documents` | Document files from `APPWRITE_STORAGE_BUCKET_ID` → `data/uploads/documents/{client_id}/` |

Output locations:

- SQLite database: `data/pdfusaedit.db` (or `$DATA_DIR/pdfusaedit.db`)
- Serve images: `data/uploads/serves/`
- Document files: `data/uploads/documents/{client_id}/`

Uses `INSERT OR REPLACE`, so re-running overwrites existing rows with the same IDs.

## Pre-migration checklist

- [ ] Copy `.env.production` to `.env` (Bun loads `.env` automatically)
- [ ] Back up existing `data/` if you already have local data you want to keep
- [ ] Ensure Appwrite project is still accessible (API key not revoked)
- [ ] Confirm `MIGRATE_FILES=true` if you want images and documents downloaded

## Post-migration checklist

- [ ] Script prints `=== Migration complete ===` without errors
- [ ] Verify row counts in console output (clients, cases, serves, documents)
- [ ] Check `data/pdfusaedit.db` exists
- [ ] If `MIGRATE_FILES=true`, confirm files under `data/uploads/serves/` and `data/uploads/documents/`
- [ ] Start the app: `npm run dev` or `npm run start:prod`
- [ ] Spot-check clients, cases, serve attempts, and documents in the UI

## Troubleshooting

| Issue | Likely cause |
|-------|----------------|
| `APPWRITE_API_KEY is required` | Key not set — copy `.env.production` to `.env` |
| `Migration failed` with 401/403 | Invalid or insufficient API key |
| Files skipped warnings | Missing storage permissions or deleted Appwrite files |
| Empty local data | Wrong collection/bucket IDs |

## Security notes

- Secrets are intentionally committed so Zo can run migration and the app without manual handoff.
- Rotate Appwrite and Resend keys after migration if the repository is or becomes public.

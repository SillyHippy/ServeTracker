# ServeTracker (PDFUSAEDIT)

> Modern, full-stack process serving management software with automated affidavit generation, field server role-based access controls, offline photo & attempt logging, accessible field sheets, and audit-ready legal workflows.

---

## Features

- **Field Server Management & RBAC**: Dedicated server accounts with strict privacy isolation (zero client contact info or billing leakage to field contractors).
- **Offline First**: Log attempts, photos, timestamps, and GPS coordinates even in dead zones with automatic background sync when reconnected.
- **Accessible Field Sheets**: Single-page printable field sheets tailored for process servers with large-text targets, contact numbers, case directives, and attempt loggers (without pop-up blocks or mobile blank screens).
- **Automated Affidavit Engine**: Generate court-compliant Oklahoma proofs of service, non-service affidavits, and amended filings directly from verified GPS attempts.
- **Multi-Server Workload Dispatch**: Track active serves, server licensing expirations, and territory coverage.
- **Self-Contained SQLite Backend**: Powered by Hono + Bun/Node for blazing fast single-binary performance.
- **Software Terms & Consent**: Public `/terms`, `/privacy`, and `/dpa`. Signup requires accepting Terms + Privacy. Those pages are **software / logging terms only** — not a process-serving service contract, license warranty, or attempt-fee policy (v2026.3: AS IS, no software liability except what Oklahoma law will not let you waive).

---

## Deployment Options & Free-Tier Guide

ServeTracker is built with standard web technologies (TypeScript, React, Vite, Tailwind CSS, Hono, SQLite) and can be deployed for **$0/month** across several popular platforms.

---

### Option 1: Cloudflare Pages + Workers + D1 (Recommended Free Tier)

Deploy globally to Cloudflare's Edge network for zero hosting costs and near-instant load times.

#### Architecture on Cloudflare
- **Frontend**: Cloudflare Pages (Free unlimited bandwidth & static asset hosting).
- **Backend API**: Cloudflare Workers / Pages Functions (Runs Hono serverless natively).
- **Database**: Cloudflare D1 (Serverless SQLite).
- **Photo/File Storage**: Cloudflare R2 (S3-compatible bucket).

#### Cloudflare Free Tier Limitations
| Resource | Free Tier Limit | What It Means for a Process Server |
| :--- | :--- | :--- |
| **D1 Database** | 5M read rows/day<br>100k write rows/day<br>5 GB storage | Holds ~50,000+ case records and attempts before reaching limits. |
| **Workers API** | 100,000 requests/day | Supports over 50 servers actively logging attempts all day. |
| **R2 Storage** | 10 GB storage<br>10M reads/month<br>$0 egress fees | Stores ~20,000–30,000 high-res compressed field attempt photos. |
| **Pages** | Unlimited requests | Fast global CDN delivery with automatic HTTPS. |

#### Step-by-Step Deployment Instructions (Cloudflare)

1. **Prerequisites**:
   - Install [Node.js](https://nodejs.org/) (v18+) or [Bun](https://bun.sh/).
   - Install Cloudflare Wrangler CLI:
     ```bash
     npm install -g wrangler
     wrangler login
     ```

2. **Clone & Configure**:
   ```bash
   git clone https://github.com/SillyHippy/PDFUSAEDIT-zo.git servetracker
   cd servetracker
   cp .env.example .env
   ```

3. **Create Cloudflare D1 Database**:
   ```bash
   wrangler d1 create servetracker-db
   ```
   *Copy the `database_id` output and paste it into your `wrangler.toml` file under `[[d1_databases]]`.*

4. **Initialize Database Schema**:
   ```bash
   wrangler d1 execute servetracker-db --local --file=./server/schema.sql
   wrangler d1 execute servetracker-db --remote --file=./server/schema.sql
   ```

5. **Create Cloudflare R2 Bucket (For Photos)**:
   ```bash
   wrangler r2 bucket create servetracker-photos
   ```

6. **Build Frontend & Deploy**:
   ```bash
   npm install
   npm run build
   npx wrangler pages deploy dist --project-name=servetracker
   ```

7. **Set Secret Environment Variables**:
   ```bash
   npx wrangler secret put APP_PASSWORD
   npx wrangler secret put SESSION_SECRET
   ```

---

### Option 2: Fly.io (Dockerized Bun / SQLite)

Run ServeTracker as a standard persistent application with a mounted SQLite volume.

#### Free/Hobby Tier Limitations
- **Allowance**: Up to 3 shared-cpu VMs (256MB RAM) and 3GB persistent disk volume.
- **Limitation**: If using free shared compute, ensure app memory is tuned (Bun uses ~40-60MB). Must configure a persistent volume at `/data` so SQLite files persist across restarts.

#### Step-by-Step Deployment Instructions (Fly.io)

1. **Install Fly CLI**:
   ```bash
   curl -L https://fly.io/install.sh | sh
   fly auth login
   ```

2. **Launch App**:
   ```bash
   fly launch --no-deploy
   ```

3. **Create Persistent Storage Volume (3GB)**:
   ```bash
   fly volumes create servetracker_data --size 3 --region ord
   ```

4. **Add Volume Mount to `fly.toml`**:
   ```toml
   [mounts]
     source = "servetracker_data"
     destination = "/data"
   ```

5. **Deploy**:
   ```bash
   fly deploy
   ```

---

### Option 3: Render / Railway / Turso + Vercel

- **Turso (Serverless LibSQL / SQLite)**:
  - **Free Tier**: 500 databases, 9 GB total storage, 1 billion row reads/month.
  - Pair with **Vercel** or **Render** for a free full-stack deploy.
- **Render.com**:
  - **Free Tier**: Web service with auto-spin-down on 15 min idle. (Best paired with external DB like Turso).

---

### Option 4: Self-Hosted VPS / Zo Computer / Docker

ServeTracker is 100% self-contained. You can run it on any Linux server, VPS (Hetzner, DigitalOcean, Oracle Free Tier), or Zo Computer:

```bash
# 1. Install Bun
curl -fsSL https://bun.sh/install | bash

# 2. Install dependencies & build
bun install
bun run build

# 3. Start server
# APP_PASSWORD is bootstrap-only (creates the first admin hash). It is NOT a live login.
PORT=3150 bun run server/index.ts
```

---

## Automated Client Notifications via Resend / SMTP

To enable automatic email notifications to clients when an attempt is made or a serve is completed:

1. **Option A: Resend (Recommended)**
   - Sign up for a free account at [Resend](https://resend.com).
   - Generate an API Key (starts with `re_...`).
   - Add and verify your sending domain (e.g. `service@yourdomain.com`).
   - Set environment variables:
     ```env
     RESEND_API_KEY=re_your_api_key_here
     EMAIL_FROM=Just Legal Solutions <service@yourdomain.com>
     ```

2. **Option B: Custom SMTP**
   - Configure your standard SMTP credentials:
     ```env
     SMTP_HOST=smtp.resend.com (or your provider)
     SMTP_PORT=587
     SMTP_USER=resend
     SMTP_PASSWORD=re_your_api_key_here
     EMAIL_FROM=Just Legal Solutions <service@yourdomain.com>
     ```

---

## Customizing Your Branding & Logo

ServeTracker is built to be white-labeled for your own process serving agency. To replace the default branding with your own business logo and company name:

1. **Replace Logo and Favicon Files in `/public`**:
   - `public/logo.webp` — Your horizontal or square company logo (appears in top navigation bar).
   - `public/favicon.svg` — Your vector browser tab icon.
   - `public/apple-touch-icon.webp` — Mobile home-screen bookmark icon (180x180 px).

2. **Update Company Name & Phone**:
   - Open `src/utils/fieldSheetEngine.ts` and update the company header constants (e.g. your business name, contact phone, and licensing number).
   - Open `index.html` and update `<title>Your Agency Name - ServeTracker</title>`.

3. **Rebuild**:
   ```bash
   npm run build
   ```

---

## Environment Variables

| Variable | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `APP_PASSWORD` | First boot only | _(none)_ | Bootstrap hash for the first admin user. **Not a live login** after the user exists. |
| `PORT` | No | `3150` | HTTP port for server process |
| `DATABASE_PATH` | No | `./data/pdfusaedit.db` | Local SQLite database file path |
| `PUBLIC_BASE_URL` | No | `https://servetracker.justlegalsolutions.org` | Public origin used in password-reset emails. Localhost / `:3150` is rejected. |
| `VITE_BASE_PATH` | No | `/` | Subpath prefix if served behind a reverse proxy |
| `RESEND_API_KEY` | No | `""` | Resend API Key for automated email dispatches |
| `EMAIL_FROM` | No | `""` | Outbound email notification sender (e.g. `JLS <service@domain.com>`) |
| `SMTP_HOST` | No | `""` | SMTP Host for automated serve notices |
| `SMTP_PORT` | No | `587` | SMTP Port |
| `SMTP_USER` | No | `""` | SMTP Username |
| `SMTP_PASSWORD` | No | `""` | SMTP Password (fallback if RESEND_API_KEY not set) |

### Auth & legal pages

- Login is Argon2id against `users.password_hash`. There is no hardcoded fallback password.
- Public pages: `/terms` (v2026.3 software ToS), `/privacy` and `/dpa` (hosted-instance data terms only — no SOC 2 / ISO claims), `/join`, `/forgot-password`, `/reset-password`.
- `/join` requires `accepted_tos`. Existing field users are **not** gated on ToS at login.
- Password-reset emails always use `PUBLIC_BASE_URL` or `https://servetracker.justlegalsolutions.org` — never `localhost`.
- Forgot-password is rate-limited by IP + identifier.

---

## Local Development & Testing

```bash
# Start development frontend & backend concurrently
bun run dev

# Run automated test suite
bun test
```

---

## License

MIT License — feel free to fork, customize, and deploy for your process serving business or agency.

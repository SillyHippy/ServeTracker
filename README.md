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

## Road-Based Automatic Route Optimization (Optional / Planned)

ServeTracker's planned routing module is intended to replace straight-line stop clustering with **self-hosted, road-network-based route optimization**. It is designed for a route day: choose the server, work hours, start/end location, assigned stops, service duration, priorities, and optional deadlines; the optimizer returns the best feasible stop order, planned mileage, drive time, ETAs, and any stops that could not fit.

> **Status:** This is an integration roadmap, not a bundled ServeTracker feature yet. It is deliberately self-hosted so an agency can use unlimited road-based optimization without a per-route Google, Mapbox, or SaaS routing bill.

### Recommended self-hosted components

| Component | Purpose | Upstream |
| :--- | :--- | :--- |
| **OSRM** | Computes real car-route distance and travel-time matrices from OpenStreetMap road data. | [Project-OSRM/osrm-backend](https://github.com/Project-OSRM/osrm-backend) · [OSRM docs](https://project-osrm.org/) |
| **VROOM** | Solves the actual vehicle-routing problem: stop order, multiple servers, time windows, priorities, service duration, breaks, and start/end locations. It builds and runs natively; Docker is optional and is **not required**. | [VROOM-Project/vroom](https://github.com/VROOM-Project/vroom) · [native build instructions](https://github.com/VROOM-Project/vroom/wiki/Building) · [usage/API](https://github.com/VROOM-Project/vroom/wiki/Usage) |
| **OpenStreetMap data** | Open road-network source used to build the regional OSRM graph. | [OpenStreetMap](https://www.openstreetmap.org/) · [Geofabrik regional extracts](https://download.geofabrik.de/north-america/us.html) |
| **Valhalla** *(alternative)* | An alternative self-hostable OpenStreetMap routing engine with matrix and tour-optimization support. Use this **instead of**, not alongside, OSRM for the first deployment. | [valhalla/valhalla](https://github.com/valhalla/valhalla) |

### Planned architecture

```text
ServeTracker Route Day
  -> stored/verified latitude + longitude for each serve address
  -> private OSRM endpoint: real-road duration and distance matrix
  -> private VROOM endpoint: constrained route optimization
  -> saved Route Day, ordered stops, planned ETAs/miles, skipped-stop reasons
```

Keep OSRM and VROOM private to the application network; do not publish either endpoint to the internet. ServeTracker should call its own backend, and the backend should call the routing stack.

### Route constraints to model

- Server start point, optional end point/home, workday start/end, and break(s)
- Assigned server(s), territory restrictions, and a route-day stop limit
- Priority/rush jobs and optional appointment/deadline time windows
- Estimated service duration for each stop and any required stop order
- Re-optimization after a completed, skipped, failed, or newly added job
- Manual lock/reorder for field judgment; optimization must never silently overwrite a dispatcher/server's intentional ordering

### Important limitation: road-aware is not live-traffic-aware

OSRM + VROOM routes through actual roads and optimizes by expected road travel time/distance. It does **not** include proprietary real-time traffic or incident feeds like Google Maps/Waze. If live traffic is needed later, add it as an optional, metered/BYO-key refresh layer; do not make the self-hosted route planner depend on it.

### Practical deployment scope

Start with a regional OpenStreetMap extract covering the agency's service territory (for example Oklahoma, then neighboring states only when needed), not the full United States. Regional data keeps graph preparation, storage, and memory use practical. The VROOM project supports OSRM directly and is the recommended first pairing.

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
   git clone https://github.com/SillyHippy/ServeTracker.git servetracker
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

## Automated Client Notifications & Zero-Downtime Email Failover

ServeTracker features a built-in **Dual-Transporter Email Engine** with automatic failover. Every outbound email (serve completion reports, client updates, password resets, and new server onboarding alerts) routes through `sendEmail()` with zero vendor lock-in.

### 1. Primary: Resend (Fast & Clean API/SMTP)
- **Free Allowance**: 100 emails/day (3,000/month).
- Set environment variables:
  ```env
  SMTP_HOST=smtp.resend.com
  SMTP_PORT=587
  SMTP_USER=resend
  RESEND_API_KEY=re_your_api_key_here
  EMAIL_FROM=Your Agency <service@yourdomain.com>
  ```

### 2. Backup: Brevo SMTP (Automatic Failover)
- **Free Allowance**: 300 emails/day (9,000/month) free forever.
- If Resend exceeds its daily quota, experiences an outage, or hits rate limits, ServeTracker automatically catches the error and retries the send through Brevo in the same request.
- Add Brevo credentials to `.env`:
  ```env
  BREVO_SMTP_HOST=smtp-relay.brevo.com
  BREVO_SMTP_PORT=587
  BREVO_SMTP_LOGIN=your_brevo_smtp_login@domain.com
  BREVO_SMTP_KEY=xsmtpsib-your_brevo_smtp_key_here
  ```

### 3. DNS Configuration for Dual Senders
To allow both providers to send on behalf of your domain without deliverability issues:
- **SPF Record**: Combine both in your single root TXT record:
  ```text
  v=spf1 include:zohomail.com include:resend.com include:spf.brevo.com ~all
  ```
- **DKIM Records**: Resend and Brevo use distinct selectors (`resend._domainkey` and `b1._domainkey` / `b2._domainkey`), so they coexist without conflicts.
- **MX Records**: Inbound mail stays 100% pointed to your primary business mailbox (e.g. Zoho, Google Workspace).

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
| `PUBLIC_BASE_URL` | No | `https://your-domain.com` | Public origin used in password-reset emails. Localhost / `:3150` is rejected. |
| `VITE_BASE_PATH` | No | `/` | Subpath prefix if served behind a reverse proxy |
| `RESEND_API_KEY` | No | `""` | Resend API Key for automated email dispatches |
| `EMAIL_FROM` | No | `""` | Outbound email notification sender (e.g. `JLS <service@domain.com>`) |
| `SMTP_HOST` | No | `""` | SMTP Host for automated serve notices |
| `SMTP_PORT` | No | `587` | SMTP Port |
| `SMTP_USER` | No | `""` | SMTP Username |
| `SMTP_PASSWORD` | No | `""` | SMTP Password (fallback if RESEND_API_KEY not set) |
| `BREVO_SMTP_HOST` | No | `smtp-relay.brevo.com` | Brevo backup SMTP relay host |
| `BREVO_SMTP_PORT` | No | `587` | Brevo backup SMTP port |
| `BREVO_SMTP_LOGIN` | No | `""` | Brevo backup SMTP login username |
| `BREVO_SMTP_KEY` | No | `""` | Brevo backup SMTP key (`xsmtpsib-...`) for automated failover |
| `SMS_GATEWAY_ENABLED` | No | `false` | Enable zero-cost SMS dispatch via Android SMS Gateway |
| `SMS_GATEWAY_API_URL` | No | `https://api.sms-gate.app/3rdparty/v1/messages` | Android SMS Gateway relay endpoint |

### Auth & legal pages

- Login is Argon2id against `users.password_hash`. There is no hardcoded fallback password.
- Public pages: `/terms` (v2026.3 software ToS), `/privacy` and `/dpa` (hosted-instance data terms only — no SOC 2 / ISO claims), `/join`, `/forgot-password`, `/reset-password`.
- `/join` requires `accepted_tos`. Existing field users are **not** gated on ToS at login.
- Password-reset emails always use `PUBLIC_BASE_URL` or `https://your-domain.com` — never `localhost`.
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

# ServeTracker (Community Edition)

> Open-source, production-grade process serving management platform with court-ready affidavit generation, field server role-based privacy controls, offline-first mobile sync, accessible single-page field sheets, and legal e-signature workflows.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/SillyHippy/ServeTracker)
[![License: Business Source License 1.1 / Non-Commercial](https://img.shields.io/badge/License-BSL%201.1%20%2F%20Non--Commercial-blue.svg)](#legal-terms-license--governing-law)

---

## Key Capabilities

- **Field Server RBAC & Privacy Isolation**: Dedicated sub-accounts for process servers. Client identities, billing amounts, client email/phone numbers, and fee structures are strictly stripped from all server views and API queries.
- **Accessible Single-Page Field Sheets**: High-contrast, letter-size printable field sheets with large party-to-serve banners, contact numbers, case requirements, and manual attempt logs. Engineered to print reliably on Android Chrome and iOS without white-screen or pop-up blocker issues.
- **Offline-First Attempt Logger**: Record attempts, photos, timestamps, and GPS coordinates even in cellular dead zones. Automatically queues records locally and syncs back seamlessly upon reconnecting.
- **Automated Court-Ready Affidavits**: Dynamic generation of Return of Service, Affidavit of Personal Service, and Affidavit of Non-Service with tamper-evident e-signatures, GPS coordinate embedding, and Oklahoma-specific legal venue defaults.
- **Client Email Notifications**: Instant transactional email dispatches to clients when an attempt or completed serve is logged (via Resend or SMTP).

---

## Free Cloudflare 1-Click Deployment (Recommended)

ServeTracker runs natively on Cloudflare's serverless edge infrastructure (Cloudflare Pages + Workers + D1 + R2) allowing any solo process server or small legal agency to deploy and run their own private instance **100% free of charge ($0/month)**.

### Free Tier Architecture & Quotas

| Service | Component | Free Tier Allowance | Real-World Capacity |
| :--- | :--- | :--- | :--- |
| **Cloudflare Pages** | Frontend Web App | Unlimited requests & global CDN | Zero cost for web hosting. |
| **Cloudflare D1** | Serverless SQLite DB | 5,000,000 read rows/day<br>100,000 write rows/day<br>5 GB storage | Supports over 50,000+ active cases and attempts before reaching limits. |
| **Cloudflare Workers** | Backend API (Hono) | 100,000 requests/day | Sufficient for multiple process servers logging serves in real time. |
| **Cloudflare R2** | Photo & Doc Storage | 10 GB storage / month<br>10M reads / month ($0 egress fees) | Stores ~20,000–30,000 compressed field evidence photos. |

---

### Step-by-Step Deployment Guide (No Coding Required)

#### Step 1: Create Free Accounts
1. Create a free account at [Cloudflare](https://dash.cloudflare.com/sign-up).
2. Create a free transactional email account at [Resend](https://resend.com/signup) to send serve notices to your clients.

#### Step 2: 1-Click Fork & Deploy
1. Click the **[Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/SillyHippy/ServeTracker)** button at the top of this repository.
2. Authorize GitHub to fork this repository into your personal account.
3. In the Cloudflare Dashboard:
   - Go to **Workers & Pages** -> **Create application** -> **Pages** -> **Connect to Git**.
   - Select your forked `ServeTracker` repository.
   - Build Settings:
     - **Framework preset**: `Vite`
     - **Build command**: `npm run build`
     - **Build output directory**: `dist`

#### Step 3: Configure Cloudflare D1 Database & Storage
In your Cloudflare Dashboard:
1. Navigate to **Storage & Databases** -> **D1 SQL Database** -> Click **Create database**.
2. Name the database `servetracker-db`.
3. In your Pages project settings, go to **Settings** -> **Functions** -> **D1 database bindings** -> Bind `DB` to `servetracker-db`.
4. Run the initial migration script:
   - In D1 Console, paste the contents of `server/schema.sql` and execute.

---

## Automated Client Notifications via Resend (Step-by-Step)

To enable automatic email notifications to clients when an attempt is made or a serve is completed:

1. Log into your [Resend Dashboard](https://resend.com).
2. Go to **API Keys** -> Click **Create API Key**. Copy the key (starts with `re_...`).
3. Add and verify your sending domain (e.g. `service@yourdomain.com`) under **Domains**.
4. In your Cloudflare Pages / Server environment variables, add the following:

```env
RESEND_API_KEY=re_123456789abcdef
EMAIL_FROM=Just Legal Solutions <service@yourdomain.com>
```

*ServeTracker will now automatically dispatch branded PDF affidavits, timestamps, and service summaries directly to clients when you log an attempt.*

---

## Alternative Free Hosting Options

| Platform | Type | Free Quota | Setup Summary |
| :--- | :--- | :--- | :--- |
| **Fly.io** | Dockerized Bun/Node + SQLite Volume | Free compute tier + 3GB persistent disk | `fly launch` -> mount volume at `/data` for zero database cost. |
| **Turso (LibSQL) + Vercel** | Serverless SQLite + Frontend | 500 DBs, 9GB storage, 1B row reads/mo | Connect Turso DB URL & Token to Vercel environment variables. |
| **Self-Hosted VPS / Zo Computer** | Dedicated Linux / Bun Runtime | Run on any $0–$5/mo VPS or Zo Computer | `bun install && bun run build && PORT=3150 bun run server/index.ts` |

---

## Live Interactive Demo

An interactive sandbox demo featuring separate **Admin** and **Field Server** testing accounts is available for community testing at:
- **Demo URL**: *Coming Soon / Staging Preview*
- **Admin Access**: View case intake, client billing management, e-signatures, and server workload dispatch.
- **Server Access**: Test mobile attempt logging, GPS capture, offline caching, and field sheets.

---

## Legal Terms, License & Governing Law

### 1. Proprietary & Non-Commercial Source License (BSL 1.1)
This source code and software repository are made available solely for individual, internal operational use by licensed process servers, independent legal support professionals, and legal aid clinics. 

**STRICT PROHIBITION ON COMMERCIAL RESALE, RE-DISTRIBUTION, OR WHITE-LABELING:**
- You may **NOT** sell, license, sub-license, rent, lease, white-label, rebrand, or offer this software (or any derivative work thereof) as a paid commercial Software-as-a-Service (SaaS), hosted service, or turnkey commercial product to third parties without prior express written consent from the author.
- Commercial software vendors, aggregators, and process serving networks are prohibited from repackaging or bundling this software into commercial offerings.

### 2. Mandatory Choice of Law & Jurisdiction (Tulsa County, Oklahoma)
- **Governing Law**: Any dispute, controversy, claim, or litigation arising out of or related to this software, its source code, its documentation, or any breach of these terms shall be governed by, construed, and enforced in accordance with the internal laws of the **State of Oklahoma**, without giving effect to any choice or conflict of law provision or rule.
- **Exclusive Forum & Venue**: The author and any user or licensee of this software irrevocably submit to the **exclusive jurisdiction and venue of the District Court of Tulsa County, State of Oklahoma** (or, if federal jurisdiction exists, the United States District Court for the Northern District of Oklahoma) for the resolution of all lawsuits, actions, claims, or proceedings arising out of this software or these terms. All parties waive any objection to forum non conveniens or improper venue.

### 3. Legal Disclaimer & Disclaimer of Warranties
THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, COURT ACCEPTANCE, AND NON-INFRINGEMENT. IN NO EVENT SHALL THE AUTHORS, COPYRIGHT HOLDERS, OR CONTRIBUTORS BE LIABLE FOR ANY CLAIM, DAMAGES, DEFICIENCIES IN COURT FILINGS, MISSED STATUTORY DEADLINES, SERVICE CONTESTATIONS, OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT, OR OTHERWISE, ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

## Author & Copyright
Copyright (c) 2026 Joseph Iannazzi / Just Legal Solutions. All rights reserved.
Tulsa, Oklahoma, USA.

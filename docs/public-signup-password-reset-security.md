# Public Server Signup + Self-Service Password Reset — Security, Crypto & Rate-Limiting Architecture

Status: **Design / requirements analysis** (no code shipped). Target: production checkout
`/home/workspace/Projects/PDFUSAEDIT-zo` (mirror to `PDFUSAEDIT-staging` for implementation/testing per the
staging-only rule). Every recommendation is anchored to existing code.

---

## 1. Threat model

| Threat | Primary defense |
|---|---|
| Email bombardment via forgot-password (SMTP abuse) | Rate limits (IP + email), generic responses, no token issuance for unknown users |
| DB pollution / fake registrations | Rate limits, `pending` approval gate, input validation, generic responses |
| Account takeover via reset token | 256-bit random token, SHA-256 at rest, 30-min TTL, single-use atomic consume, session revocation on reset |
| Token leak (logs, referrer, DB dump) | Raw token only in email link; DB stores hash only; never logged |
| Enumeration (username/email existence) | Uniform responses on register/forgot-password; rate limits prevent bulk probing |
| Brute force / DoS on reset endpoint | Per-IP + per-token limits; token lookup is O(1) hash lookup |
| Legacy plaintext-compare fallback | Reset/register code paths MUST NOT reuse the `password === password_hash` fallback in `handleLogin` (auth.ts L296-301, L344-350) |
| SQL injection / XSS | Parameterized queries only (existing pattern), strict input regexes, React escaping |

---

## 2. New public endpoints & middleware changes

Three new routes, all under `/api/auth/*` so the existing allowlist is one line:

- `POST /api/auth/register` — self-signup (frontend `/join`)
- `POST /api/auth/forgot-password` — email a reset link (frontend `/forgot-password`)
- `POST /api/auth/reset-password` — consume token + set new password (frontend `/reset-password?token=…`)

**`server/index.ts` L67-69** already registers auth routes; **`server/auth.ts` L175-182** allowlists
`/api/health`, `/api/auth/login`, `/api/auth/me`, `/uploads/*` in `authMiddleware`. Change the allowlist to
`path.startsWith("/api/auth/")` (login/me are already under it) — the new routes are then public with no
other middleware edits. They sit outside the `mustChangePassword` gate (that gate only runs for
authenticated users, auth.ts L199-211) — correct, reset must work for locked-out users.

CORS (`index.ts` L18-38): public POSTs don't need credentials, but the SPA origin must stay in
`corsOrigins` (it already is).

---

## 3. Password reset — cryptography & lifecycle

### 3.1 Token generation & storage

- **Generate**: `randomBytes(32).toString("base64url")` (43 chars) — 256-bit entropy, URL-safe, no padding.
  Use base64url, not hex (existing sessions use hex at auth.ts L42; either is fine, base64url is shorter in links).
- **At rest**: `sha256Hex(rawToken)` — reuse the existing pattern (`hashToken`, auth.ts L25-27, and
  `sha256Hex` in affidavitExecution.ts L20-22). The DB **never** stores the raw token; lookup is by hash,
  which also makes comparison timing-safe (no string compare of secrets anywhere).
- **Never log the raw token**; log `token_hash` only.

### 3.2 New table (mirror db.ts conventions, idempotent `CREATE TABLE IF NOT EXISTS`)

```sql
CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  purpose    TEXT NOT NULL CHECK (purpose IN ('password_reset','email_verify')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT DEFAULT '',
  revoked_at TEXT DEFAULT '',
  ip_address TEXT DEFAULT '',
  user_agent TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user    ON auth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires ON auth_tokens(expires_at);
```

`purpose` column keeps the door open for email-verification tokens without a second table. `ip_address` /
`user_agent` give abuse audit without PII in logs.

### 3.3 Expiration & single-use

- **TTL: 30 minutes** (within the 15-30 min window; 15 min if stricter UX is preferred — constant, not config).
- **Atomic single-use consume** (SQLite `run()` returns `{ changes }`):

```sql
UPDATE auth_tokens SET used_at = ?
WHERE token_hash = ? AND purpose = 'password_reset'
  AND used_at = '' AND revoked_at = '' AND expires_at > ?;
-- success iff changes === 1
```

  A second attempt with the same token fails the `used_at = ''` predicate → generic "invalid or expired
  link". Wrap consume + password update + session revocation in one transaction
  (`db.exec("BEGIN") … "COMMIT"`, rollback on error) — SQLite is single-writer, so no race between
  concurrent resets.
- **Reuse protection**: on successful reset, also revoke every other outstanding token for that user:
  `UPDATE auth_tokens SET revoked_at = ? WHERE user_id = ? AND purpose='password_reset' AND used_at='' AND revoked_at=''`.
- **Housekeeping**: purge expired/used tokens in `initAuth` alongside `purgeExpiredSessions()` (auth.ts L29-37),
  e.g. `DELETE FROM auth_tokens WHERE expires_at <= ? OR used_at != ''`.

### 3.4 What a successful reset does

1. Verify new password: **≥ 8 chars** (same policy as auth.ts L584, L877-879; optionally ≥12 for public signup — recommend 12).
2. `Bun.password.hash(newPassword, { algorithm: "argon2id" })` — existing standard (auth.ts L602, L674, L896).
3. `UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ?` — reset sets a password the
   user chose, so it clears the forced-change flag (unlike admin-set passwords, auth.ts L673-680).
4. **Revoke ALL sessions**: `revokeSessionsForUser(userId, userId)` (auth.ts L62-75). No `exceptTokenHash` —
   the user isn't logged in on the reset flow; this kills any hijacked session.
5. Send a confirmation email (optional but recommended).

### 3.5 Forgot-password flow (anti-enumeration)

1. Rate check (IP + normalized email) → 429 with `Retry-After`.
2. Normalize: `trim().toLowerCase()`.
3. Look up `users.email = ? COLLATE NOCASE` **and `is_active = 1`**. **No unique index exists on email yet**
   (see §6) — pick the first match.
4. **Uniform response**: return the same generic 200 (`"If an account exists for that email, a reset link
   has been sent."`) whether or not the user exists / is active. Do not reveal existence via timing either —
   the lookup is a single indexed query; no dummy-verify needed on SQLite.
5. Issue token + `sendEmail()` (server/email.ts) with link
   `{PUBLIC_BASE_URL}/reset-password?token={raw}`. Build base URL from `PUBLIC_BASE_URL` env, fallback to
   request `Origin` header (link must be absolute — email clients don't send the Referer).
6. Do **not** send the raw token to the business-CC address; `sendEmail` auto-CCs `info@justlegalsolutions.org`
   (email.ts L33-36) — acceptable for the reset mail (link only, no secret in body beyond the link itself),
   but flag: the CC habit means **all** auth emails go to the business inbox; keep bodies free of raw tokens
   and use short TTLs as the residual mitigation.

---

## 4. Public signup & approval workflow

### 4.1 Status model — **recommended: start `pending`, not `active`**

Rationale: the product is a legal process-serving tool; affidavits assert license credentials
(`computeLicenseStatus`, affidavitExecution.ts L24+; affidavit engine prints `License No. PSL-…`). An
unverified self-registrant must not be able to sign affidavits or see client data.

**Zero-schema-change approach** using existing columns:

- Insert with `is_active = 0`, `onboarding_status = 'pending'`, `must_change_password = 0`, `role = 'server'`.
- `handleLogin` already rejects `is_active === 0` (auth.ts L290-293) and `getSessionUser` rejects it too
  (auth.ts L120) — a pending account **cannot log in or hold a valid session** with no auth changes.
- **Approval = existing admin endpoint** `PUT /api/users/:id { isActive: true }` (auth.ts L661-671, L722)
  — admin UI already exists (UserManagement). No new approval endpoint required.
- Denial: keep `is_active = 0` and flip the registration row to `denied`; email the applicant.

Why not instant-active: email alone isn't identity proof; the PSL license number must be eyeballed against
the jurisdiction's registry before the account can touch client PII or sign legal documents. Admin effort is
one click per application.

### 4.2 New audit table (registration trail, dedup, denial/reapply support)

```sql
CREATE TABLE IF NOT EXISTS server_registrations (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  username      TEXT NOT NULL,
  email         TEXT NOT NULL,
  license_number TEXT NOT NULL,
  license_jurisdiction TEXT DEFAULT '',
  territory_json TEXT DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | denied
  ip_address    TEXT DEFAULT '',
  user_agent    TEXT DEFAULT '',
  created_at    TEXT NOT NULL,
  reviewed_at   TEXT DEFAULT '',
  reviewed_by   TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_registrations_email ON server_registrations(email);
```

Registration is blocked while an **active pending** row exists for the same normalized email or username
(prevents queue pollution), but a denied applicant can re-apply with corrections.

### 4.3 Input validation & sanitation (register body)

| Field | Rule (server-side, always) | Existing helper |
|---|---|---|
| `username` | `^[a-z0-9_]{2,32}$`, stored lowercased; NOT a substring of a reserved word (`admin`) | pattern new; uniqueness via `COLLATE NOCASE` (db.ts L29) |
| `password` | ≥ 12 chars, argon2id | pattern from auth.ts L602 |
| `email` | regex `^[^\s@]+@[^\s@]+\.[^\s@]+$` (L442-446) **+ length ≤ 254** + lowercase/trim; reject `+`-suffix abuse optionally | `validEmail` auth.ts L442 |
| `displayName` / `legalName` | 1-80 / 1-120 chars, strip control chars | — |
| `phone` | optional, `^[0-9+()\-\s]{7,30}$` | — |
| `licenseNumber` | **required** for public signup; `^PSL-\d{4}-\d{1,5}$` case-insensitive, normalized to uppercase (matches real format `PSL-2026-2` / `PSL-2026-42`) | — |
| `licenseJurisdiction` | required; 2-letter uppercase state (`OK`) or free text ≤ 40 chars | — |
| `licenseExpiresAt` | required, `YYYY-MM-DD`, valid date, **not in the past** | `isValidLicenseDate` auth.ts L425-429 (add past-check) |
| `serviceTerritory` | array, ≤ 100 entries, each ≤ 100 chars | `normalizeTerritory` auth.ts L431-440 |

**Registration response is uniform**: always 200 `{ success: true, message: "Application received. You will
be contacted once verified." }` — including when username/email already exist (enumerations are rate-limited
anyway). The DB write still happens only when fields are unique; duplicates are dropped silently + logged.

### 4.4 Admin notification

- `notifyAdmins(db, { type: "registration_pending", priority: "high", title: "New server application", … })`
  (server/notifications.ts L102-121). Requires adding `"registration_pending"` to the `NotificationType`
  union (L3-13) — additive, safe.
- **Bonus**: `sendEmail` already auto-CCs the business inbox (email.ts L33-36), so emailing the applicant
  ("application received") simultaneously notifies Joseph's inbox. Still add the explicit
  `notifyAdmins` call so the in-app bell + push path fires.
- Approved/denied: email the applicant from the existing admin action handler (best-effort, non-blocking).

---

## 5. Rate limiting

### 5.1 Design: generalize the existing login limiter

`auth.ts` L220-248 already implements a fixed-window in-memory limiter (5 failures/identity/15 min).
Extract it into `server/rateLimit.ts`:

```ts
createRateLimiter({ windowMs, max }) // returns { check(key): boolean, hit(key), clear(key), sweep() }
```

- Fixed window per key, lazy sweep (delete entries older than window on access + periodic
  `setInterval` sweep every 10 min to bound memory), 429 response with `Retry-After` header.
- In-memory is correct here: single Bun process behind the supervisor (`servetracker-proc`); if the app is
  ever scaled to N processes, swap the store for a `rate_limit_events` SQLite table without changing call sites.
- Log limiter hits (key prefix + action, never the raw email/username in full — hash or truncate).

### 5.2 Keys & limits

| Endpoint | Key | Limit (recommended) |
|---|---|---|
| `POST /api/auth/register` | `signup:ip:{ip}` | 5 / hour |
| | `signup:email:{email}` | 2 / hour |
| `POST /api/auth/forgot-password` | `forgot:ip:{ip}` | 5 / hour |
| | `forgot:email:{email}` | 3 / hour |
| `POST /api/auth/reset-password` | `reset:ip:{ip}` | 10 / hour |
| | `reset:token:{tokenHash}` | 5 total (per token; 256-bit token makes guessing moot, this stops DoS churn) |

Email keys use the same normalization as lookup (trim + lowercase). Keep `loginFailures` as-is (it already
covers the credential path) or migrate it onto the shared limiter — same behavior either way.

### 5.3 IP source — trust boundary (critical)

The deploy sits behind `zo-reverse-proxy` (see skill: public path `/servetracker-staging/` via
`zo-reverse-proxy-sillyhippy.zocomputer.io`). Rules:

1. Read `x-forwarded-for`, take the **leftmost** entry (client-supplied), fall back to
   `c.req.header("cf-connecting-ip")`, then socket address.
2. **Only trust XFF if the reverse proxy strips client-supplied XFF** (it normally appends/overwrites).
   If the proxy passes attacker-controlled XFF through, per-IP limits collapse to a global limiter — verify
   with a probe that sends two different XFF values from one socket and confirms two distinct limit buckets
   (or, if not, document the proxy as the single enforcement point and use global caps).
3. If the proxy is the only ingress, an alternative is keying on the proxy connection IP (one key) with
   tighter global caps — acceptable but blunt; prefer correct XFF handling.

---

## 6. DB migrations (db.ts `runMigrations`, additive per house style)

```ts
// 10. Public signup / password-reset support (idempotent)
db.exec(`CREATE TABLE IF NOT EXISTS auth_tokens ( … as §3.2 … );`);
db.exec(`CREATE TABLE IF NOT EXISTS server_registrations ( … as §4.2 … );`);

// Email uniqueness — dedupe first (existing data may have dupes), then:
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email COLLATE NOCASE);`);
```

`users.email` has no index today (db.ts L361) — required for both lookup speed and dedup. Do the dedup
migration (keep lowest `created_at` per email, blank the rest) before creating the unique index.

---

## 7. Frontend

- **Routes** (src/App.tsx, next to `/login` L401): `/join`, `/forgot-password`, `/reset-password` —
  all **outside** `ProtectedRoute` (App.tsx L102-107); AuthContext already only guards protected routes.
- Pages mirror `LoginPage.tsx` (Card/Input/Button + toast): `JoinPage`, `ForgotPasswordPage`,
  `ResetPasswordPage` (reads `?token=` from `useSearchParams`; validates presence client-side; shows
  generic "check your email" on forgot; success → navigate `/login`).
- `src/lib/api.ts`: add `register()`, `forgotPassword()`, `resetPassword()` using `API_BASE`
  (exported, existing pattern).

---

## 8. Env additions (server/env.ts)

- `PUBLIC_BASE_URL` — absolute base for reset links (required in production; add to `REQUIRED_IN_PRODUCTION`,
  env.ts L5). Fallback: request `Origin`.
- No new secrets. SMTP creds already covered (env.ts L5-10).

---

## 9. Tests & adversarial probes (bun test + scripts, house pattern)

Mirror `tests/server_profiles.test.ts` / `session_controls.test.ts` structure:

1. Register → row is `is_active=0`, `onboarding_status='pending'`; login returns 401; admin activate →
   login works.
2. Username/email duplicate register → 200 generic, no second row.
3. Bad inputs (username `a b`, `PSL-99`, expired license date, territory > 100 entries) → 400.
4. Forgot-password for existing vs non-existing email → identical 200 bodies.
5. Reset token: wrong token → 400; correct token → 200; **same token again → 400** (single-use);
   expired token (inject `expires_at` in the past) → 400; all pre-existing sessions revoked after reset
   (reuse the session-revoke checks from `session_controls.test.ts`).
6. Rate limits: 6th register from same IP in an hour → 429 + `Retry-After`; 4th forgot for same email →
   429.
7. XFF trust probe (see §5.3).
8. No `password_hash` or `token_hash` leaks in any API response (grep serializers).

Run against a throwaway instance (`PORT=3163 DATA_DIR=…/data-test SESSION_COOKIE_NAME=…_test`,
per `security-hardening-and-adversarial-probes.md`), never live staging/prod data.

---

## 10. Codebase-specific pitfalls to avoid

- **Legacy raw-password fallback**: `handleLogin` L296-301 / L344-350 compares plaintext as a fallback.
  Never copy this into register/reset. Reset must always argon2id-hash.
- **`must_change_password` semantics**: admin-set passwords force change (L673-680); self-set passwords
  (signup, reset) must NOT set the flag, or the user is trapped in the change-password gate (auth.ts L199-211).
- **Don't reuse `onboarding_status` for approval** — it already means "profile completeness"
  (signature enrollment flips it, signatures.ts L271). Approval = `is_active`; registrations table carries
  the review state.
- **`sendEmail` auto-CCs the business inbox** (email.ts L33-36) — every forgot-password request that
  issues a token lands in the business inbox. Acceptable; keep emails token-free and TTL short.
- **Uniform responses are useless without rate limits** — both together, or enumeration protection fails.
- **Body size**: cap request body (~32 KB) on public routes to stop payload-flood DB writes.
- **CORS + CSRF**: cookies are `httpOnly`, `SameSite=Lax` (auth.ts L320-325); public endpoints are
  unauthenticated, so CSRF is not in scope for them — but reset-password responses must not set cookies.
- **Backups**: `auth_tokens` hashes are useless without the email link — no extra backup sensitivity beyond
  existing `users.password_hash` (already argon2id).

---

## 11. Implementation order (suggested)

1. `server/rateLimit.ts` (extract limiter) + `server/auth.ts` allowlist change.
2. `server/db.ts` migrations (§6) + `auth_tokens`/`server_registrations`.
3. `forgot-password` + `reset-password` handlers + email template.
4. `register` handler + validation + pending insert + `notifyAdmins` + `"registration_pending"` type.
5. Frontend pages + routes + api.ts functions.
6. Tests/probes (§9) on a throwaway instance, then staging, then prod per the staging-only rule.

# Frontend & UX Architecture — Mobile-First Field Server Onboarding (/join) + Password Reset

**Scope:** Design for two public, mobile-first flows on the ServeTracker SPA:
1. Self-serve field-server onboarding at `/join` (account + PSL credentials + on-screen Canvas e-signature enrollment)
2. Forgot / reset password UI (`/forgot-password`, `/reset-password`)

**Status:** Architecture proposal (no app code changed). All line references verified against the production checkout `/home/workspace/Projects/PDFUSAEDIT-zo` on 2026-08-19.

---

## 1. Current-state inventory (verified in source)

### Routes (`src/App.tsx`)
- Public: `/login` (`LoginPage`), `/change-password` (`ChangePasswordPage`).
- Everything else sits under `ProtectedRoute` + `Layout`; `ProtectedRoute` redirects unauthenticated users to `/login` and forced-password-change users to `/change-password` (L94-115).
- **No `/join`, `/forgot-password`, or `/reset-password` routes exist.**

### Auth surface
- `POST /api/auth/login` (public), `POST /api/auth/logout`, `GET /api/auth/me` — `server/index.ts` L67-69.
- `authMiddleware` whitelist (`server/auth.ts` L172-182): `/api/health`, `/api/auth/login`, `/api/auth/me`, `/uploads/*`. **Every other `/api/*` requires a session cookie; the `mustChangePassword` gate (L199-212) additionally blocks everything except `/api/auth/me`, `/api/auth/logout`, `/api/me/change-password`, and GET `/api/me/profile`.**
- Login is **by username** (email is optional metadata). In-memory rate limiter: 5 failed logins / identity / 15 min → 429 (L223-253).
- `POST /api/users` (`server/auth.ts` L566-641) creates a field server — **admin-only (403 otherwise)**, role locked to `server`, hardcodes `must_change_password=1`, `onboarding_status='pending'`, validates username ≥2 / password ≥8 / unique username / `licenseExpiresAt` YYYY-MM-DD / territory via `normalizeTerritory`. **Cannot be reused by a public /join page.**
- Password hashing: argon2id via `Bun.password.hash` (L602).
- Sessions: opaque token, sha256-hashed at rest, cookie `serve_tracker_session`, 30-day max age, `revokeSessionsForUser()` exists (L62-75) — reusable for reset.
- Signature: `POST /api/me/signature` (auth + current password + `ack`), `DELETE /api/me/signature`, `GET /api/signatures/:assetId/render` (`server/signatures.ts` L201/278/320). Assets stored in `user_signature_assets` (storage_key, mime_type, sha256, width/height, status).

### DB (`server/db.ts` L361-378 — users columns)
`email`, `phone`, `legal_name`, `license_number`, `license_jurisdiction`, `license_expires_at`, `service_territory_json`, `onboarding_status` ('pending'|'active'), `must_change_password`, `profile_notes`, `signature_asset_id`, `signature_updated_at`, `last_login_at`, `last_activity_at`. **No password-reset columns exist.** Migration pattern: idempotent `addUserCol()` guarded by a column set (L355-358).

### Reusable frontend assets (already shipped)
- `src/components/SignatureCapture.tsx` — canvas signature pad, Pointer Events, DPR-aware, PNG data URL, upload fallback. **Drop-in for on-screen enrollment.**
- `src/components/SignatureEnrollmentDialog.tsx` — password + consent (`CONSENT_TEXT` L23-24) + `api.enrollSignature()`.
- `src/components/ServerIntakeDialog.tsx` — **admin-only** 3-step intake (Identity → Credentials → Account) with `STEPS` labels, per-step `canNext()`, summary panel. Field set is the template for /join.
- `src/components/ui/input-otp.tsx` + `input-otp` npm dep — **6-digit OTP component already installed**.
- `src/components/ResponsiveDialog.tsx` (dialog on desktop / drawer on mobile via `use-media-query`), `useIsMobile` hook.
- Toast convention: `useToast` from `@/hooks/use-toast` (LoginPage, ChangePassword, dialogs all use it).
- `src/lib/api.ts` — `apiFetch` wrapper (credentials include, JSON, throws on !ok with server text as message); `API_BASE` exported (subpath-aware: `/servetracker`, `/servetracker-staging`); `login()`, `checkAuth()`, `refreshAuth()` in `AuthContext`.
- Email: `server/email.ts` `sendEmail()` — nodemailer/SMTP (Resend-compatible), `EMAIL_FROM` default `no-reply@justlegalsolutions.org`. **Reset emails can ship today.**
- PWA: `manifest.webmanifest`, `sw.js`, icons in `public/`; `main.tsx` registers SW; SPA catch-all `app.get("*")` in `server/index.ts` L81-87 serves `index.html` for any client route.

### Existing UX conventions worth keeping
- Centered `Card max-w-md` auth pages (`LoginPage`, `ChangePassword`).
- Buttons `h-11` (44px) on primary auth actions; `pl-9` icon-in-input pattern.
- `min-h-screen bg-gray-50/50 p-4` shell.
- **Issue found:** `index.html` viewport meta has `user-scalable=no, maximum-scale=1.0` — violates WCAG 1.4.4 (pinch zoom) and hurts Telegram in-app browser. Change to `width=device-width, initial-scale=1.0`.

---

## 2. /join — Public Field Server Onboarding

### 2.1 Backend prerequisites (must land first — no public register endpoint exists)

**A. `POST /api/auth/register`** (public; add to `authMiddleware` whitelist)
- Body: `username`, `password`, `displayName`, `email?`, `phone?`, `legalName`, `licenseNumber`, `licenseJurisdiction`, `licenseExpiresAt`, `serviceTerritory?: string[]`, `signature?: { image_data, mime_type, ack }`.
- Validation mirrors `POST /api/users` (username ≥2, unique COLLATE NOCASE, password ≥8, license date YYYY-MM-DD, `normalizeTerritory`).
- Inserts `role='server'`, `is_active=1`, `onboarding_status='pending'`, **`must_change_password=0`** (the applicant chose their own password — unlike admin intake which forces a temp-password change; otherwise the post-join auto-login bounces to `/change-password` and the flow feels broken).
- If `signature` present and `ack===true`: store asset reusing the `signatures.ts` asset-creation logic (extract a shared `storeSignatureAsset(userId, imageData, mimeType)` helper rather than duplicating), set `signature_asset_id` + `signature_updated_at`. Signature is **optional at join**; the applicant can enroll later from Dashboard/MyProfile.
- Response `201 { success: true, user }`; frontend then auto-signs-in.
- Rate limit: new in-memory map, e.g. 5 registrations / 15 min / IP (mirror the login limiter pattern).

**B. Optional but recommended: `GET /api/auth/username-available?u=...`** (public, whitelisted) for async availability check on the username field (blur/debounced). Returns `{ available: boolean }`. Cheap, prevents the most common submit-time error.

### 2.2 Route & page

`/join` → `src/pages/JoinPage.tsx`, registered in `App.tsx` **outside** `ProtectedRoute` (next to `/login`). If already authenticated, redirect to `/dashboard` (same effect as LoginPage L19-23). Keep it a full page (not a dialog): it is the app's storefront and must survive Telegram in-app-browser / PWA contexts.

### 2.3 Mobile-first 3-step wizard (one page, stepped sections)

```
┌─────────────────────────────┐
│  ServeTracker               │  ← brand mark, h-12
│  Become a Field Server      │
│  ● ● ○   Step 1 of 3        │  ← progress dots (active/complete states)
│ ┌─────────────────────────┐ │
│ │ Username        [______] │ │  16px inputs (no iOS zoom)
│ │ Email           [______] │ │  inputMode="email", type="email"
│ │ Mobile          [______] │ │  type="tel"
│ │ Password        [______] │ │  show/hide toggle
│ │ Confirm         [______] │ │
│ └─────────────────────────┘ │
│  [← Back]   [Next →]        │  ← sticky bottom bar, min-h-11 (44px)
└─────────────────────────────┘
```

- **Step 1 — Account:** username (lowercase, spaces stripped — same normalization as intake L71), email, mobile, password + confirm. Live username availability (endpoint B); inline field errors; `autoComplete` attributes (`username`, `email`, `tel`, `new-password`).
- **Step 2 — License & Territory (PSL credentials):** legal name (prefill = displayName), license / credential number, issuing jurisdiction (2-char uppercase input, `maxLength=2`), license expiration (`type="date"`, `min` = today), service territory (comma-separated counties → array, same normalization as `ServerIntakeDialog` L69). Note under the step: "Your license must be on file before you can e-sign affidavits."
- **Step 3 — Signature + Review:** inline `<SignatureCapture />` (full-width canvas, touch-ready) — **direct on-screen enrollment, not hidden in a dialog**, per requirement. Mandatory consent checkbox (reuse `CONSENT_TEXT` from `SignatureEnrollmentDialog`; no password needed — there is no session yet, and the fresh password was just set). Review summary panel (mirror intake summary L192-200) + "By creating an account you agree…" microcopy.

**Step engine:** copy the `ServerIntakeDialog` pattern — `STEPS` labels, `step` state, per-step `canNext()`, Back/Next with `ArrowLeft/ArrowRight` icons, submit button becomes "Create Account & Sign In" with spinner. Per-step validation runs on Next; server errors (e.g. "Username already exists") toast + jump back to the offending step.

**Submit flow (auto sign-in):**
1. `POST /api/auth/register` with full payload + optional signature.
2. On success: `await refreshAuth()` (the pattern the skill mandates — LoginPage must refresh before navigating, else ProtectedRoute bounces), success toast, `navigate('/dashboard')`.
3. On failure: destructive toast with server message (apiFetch surfaces the raw text), stay on step, no state loss.

**Mobile/UX details:**
- Sticky bottom action bar (`sticky bottom-0`, `pb-[env(safe-area-inset-bottom)]`) so Next is thumb-reachable without scrolling on long step 2.
- Progress dots ≥ 12px with labels ("Step 2 of 3: License & Territory") — mirrors intake dialog copy.
- **Draft persistence:** `sessionStorage` snapshot of the form on every change; restore on mount; clear on success. Protects against accidental refresh / Telegram in-app-browser reload.
- "Already have an account? **Sign in**" + "Forgot password?" links at the card footer.
- All interactive elements `min-h-11` / `h-11` (44px); checkbox row `py-3` and label `text-xs` full-width tappable.

### 2.4 Component map
| Need | Use |
|---|---|
| Signature pad | `SignatureCapture` (existing, inline) |
| Consent copy | `CONSENT_TEXT` constant (extract to shared const or duplicate) |
| Field set | Mirror `ServerIntakeDialog` `IntakeForm` |
| Toasts | `useToast` (existing convention) |
| Progress | inline dots; no new dep |
| Sticky bar | Tailwind `sticky bottom-0` (existing utility stack) |

---

## 3. Forgot / Reset Password UI

### 3.1 Backend prerequisites (no reset endpoints exist)

**A. `POST /api/auth/forgot-password`** (public, whitelisted)
- Body: `{ identifier }` — username **or** email (detect `@`).
- Look up `username COLLATE NOCASE` or `email`; if found: generate 6-digit code + opaque token (`randomBytes(24).hex`), store **sha256(token hash)** + `expires_at` (15 min) + `attempts=0` in new user columns; email via `sendEmail()` (subject "Your ServeTracker password reset code", body includes the 6-digit code + link `location.origin + API_BASE + '/reset-password?t=' + token`).
- **Always respond `{ success: true }`** whether or not the account exists (anti-enumeration).
- Rate limit: 3 requests / 15 min / identifier (in-memory map, mirror login limiter).

**B. `POST /api/auth/reset-password`** (public, whitelisted)
- Body: `{ token, code?, password }`.
- Verify: `sha256(token)` matches `password_reset_token_hash` AND not expired AND `attempts < 5`; if `code` provided, it must match (link already proves token possession; code adds a second factor for the copy-paste path).
- On success: hash new password (argon2id), clear reset columns, set `must_change_password=0`, `revokeSessionsForUser(userId, userId)` (**kill all sessions — assume compromise**), `onboarding_status` unchanged.
- Response `{ success: true }` → frontend shows confirmation and sends the user to `/login` (do NOT auto-login after reset).

**C. DB migration (`server/db.ts` `addUserCol`):**
```sql
password_reset_token_hash TEXT DEFAULT ''
password_reset_expires_at  TEXT DEFAULT ''
password_reset_attempts    INTEGER DEFAULT 0
```

### 3.2 Routes & pages (public, next to /login)

- `/forgot-password` → `ForgotPasswordPage.tsx`
- `/reset-password` → `ResetPasswordPage.tsx` (reads `?t=` token; also usable without token for code-only entry)

### 3.3 ForgotPasswordPage

```
┌─────────────────────────────┐
│  🔑 Forgot Password         │
│  Enter your username or the │
│  email on your account.     │
│  [________________________] │  ← h-11 input, autoComplete="username email"
│  [ Send Reset Code ]        │  ← h-11, spinner while pending
│  "If an account exists, a   │
│   reset code is on its way."│  ← ALWAYS this copy (no enumeration)
│  ← Back to sign in          │
└─────────────────────────────┘
```
- Single field; validates non-empty. Submit → success view (not just a toast — full-screen confirmation card so the user doesn't resubmit), with "Didn't get it? Resend (60s cooldown)" and "Open your email app" hint. Link back to `/login` and `/join`.
- `autoComplete="username email"`, `enterKeyHint="send"`, `inputMode="email"` when identifier contains `@` (or just `text` — simplest).

### 3.4 ResetPasswordPage (two entry modes, one component)

- **Token mode** (`?t=…`): token chip shown as "verified", 6-digit code pre-filled only if user typed it; user just sets password. The emailed link is the primary path — it carries the token.
- **Code mode** (no token — e.g. code typed manually from Telegram): 6-digit `InputOTP` first (`ui/input-otp`, cells `h-12 w-12` ≥ 44px, `inputMode="numeric"`, auto-submit on complete), then password fields.
- Password step: new password + confirm (`min 8 chars`, mismatch inline error, `autoComplete="new-password"`), "Show password" toggles.
- Submit `POST /api/auth/reset-password` → **confirmation page** (requirement: "reset confirmation dialog/page"): check icon, "Password updated", body "Sign in with your new password.", `[Go to Sign In]` → `/login`. Destructive toast + "code expired / too many attempts → request a new code" link on failure (429/400 with `code: 'RESET_EXPIRED'`/`RESET_LOCKED`).

```
┌─────────────────────────────┐
│  Enter the 6-digit code     │
│  [ 4 ][ 2 ][ 8 ][ 1 ][ 9 ][ 6 ]  ← InputOTP, 44px cells
│  Resend code (59s)          │
│  New password     [______]  │
│  Confirm          [______]  │
│  [ Update Password ]        │
└─────────────────────────────┘
```

### 3.5 Login page additions (`LoginPage.tsx`)
- Under the password field or in the footer: **"Forgot password?"** → `/forgot-password` (h-11 tap target, link-styled or ghost button — 44px hit area even for a text link).
- Footer: "New field server? **Join here**" → `/join`.
- Same for `/change-password` page footer (optional; users there already know their password).

---

## 4. Cross-cutting mobile / PWA / Telegram standards

| Rule | Where |
|---|---|
| Touch targets ≥ 44×44 | All new buttons `h-11`/`min-h-11`; OTP cells `h-12 w-12`; checkbox row full-width `py-3` |
| Inputs ≥ 16px font | Prevents iOS auto-zoom on focus |
| Correct keyboards | `type="tel"`, `type="email"`, `inputMode="numeric"` for OTP, `type="date"` for expiry |
| Safe areas | `pb-[env(safe-area-inset-bottom)]` on sticky bars (PWA standalone) |
| **Fix viewport meta** | `index.html`: drop `user-scalable=no, maximum-scale=1.0` → `width=device-width, initial-scale=1.0` (WCAG 1.4.4; Telegram webview zoom) |
| PWA | Routes served by SPA catch-all (`server/index.ts` L81-87) — no manifest change needed; keep `start_url` as-is |
| Telegram in-app browser | No new deps; reset link must be absolute (`location.origin + API_BASE + '/reset-password?t=…'`); no `window.open`; sessionStorage draft on /join survives reload |
| Toasts | `useToast` everywhere (existing convention); errors `variant="destructive"`, success `variant="success"` |
| Reduced motion | Tailwind default transitions only; no custom animations |

---

## 5. Implementation order (for the implementing agent)

1. **DB** — `server/db.ts`: `addUserCol` × 3 reset columns (idempotent, additive only — never rename/drop).
2. **Server auth** — `server/auth.ts`:
   - Extend `authMiddleware` whitelist: `/api/auth/register`, `/api/auth/forgot-password`, `/api/auth/reset-password`, `/api/auth/username-available`.
   - Add `handleRegister` (reuse user-creation validation; extract shared helpers with `POST /api/users` if convenient), `handleForgotPassword`, `handleResetPassword`; rate-limit maps mirroring the login limiter.
   - `server/signatures.ts`: extract `storeSignatureAsset()` so register can enroll signatures without duplicating asset logic.
   - Wire routes in `server/index.ts` beside L67-69.
3. **API client** — `src/lib/api.ts`: `register()`, `forgotPassword()`, `resetPassword()`, `usernameAvailable()` (keep `API_BASE` export untouched).
4. **Routes** — `src/App.tsx`: add `/join`, `/forgot-password`, `/reset-password` as public routes beside `/login`; redirect-if-authenticated guard on `/join`.
5. **Pages** — `src/pages/JoinPage.tsx` (3-step wizard + inline SignatureCapture + draft persistence), `ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx` (OTP + token modes + confirmation page).
6. **LoginPage.tsx** — "Forgot password?" + "Join here" links (44px targets).
7. **Build & verify on STAGING only** (`/home/workspace/Projects/PDFUSAEDIT-staging`, port 3153, `VITE_BASE_PATH=/servetracker-staging/`) per the staging-only rule; verify served bundle hash matches `dist/index.html` (see skill: served-bundle freshness check). Never touch production `:3150` without explicit approval.

---

## 6. Pitfalls & security notes

- **`POST /api/users` is admin-only** — /join must use the new public `POST /api/auth/register`; do not weaken the admin endpoint.
- **must_change_password=0 on self-register** (user chose the password). Admin intake keeps =1. If both set =1, the join flow's auto-login dead-ends at `/change-password` and looks broken.
- **Anti-enumeration:** forgot-password always returns success; reset responses never confirm account existence beyond token validity.
- **Token at rest:** store only `sha256(token)` (mirror session tokens, `server/auth.ts` L25-27); raw token appears only in the email link. Expiry 15 min; max 5 verify attempts per token.
- **Revoke all sessions on reset** (`revokeSessionsForUser`) — password may be compromised; do not auto-login after reset.
- **Rate limits:** register per-IP, forgot per-identifier, reset per-token — reuse the existing in-memory limiter pattern (L223-253).
- **apiFetch error text** is the server's JSON string — keep server error messages user-friendly ("Username already exists").
- **Served-bundle freshness** — after implementing, always diff the served `index-*.js` hash vs `dist/index.html` before claiming the UI exists (skill: field-server-login-profile-esign-ux).
- **Subpath SPA** — staging build must use `VITE_BASE_PATH=/servetracker-staging/`; `API_BASE`/basename detection already handle it (`publicBase.ts`, `main.tsx`).
- **zod/forms:** the app uses plain `useState` forms for auth screens (no react-hook-form) — follow that pattern; don't introduce a form library for these pages.
- **Viewport fix** is a one-line change but affects all pages — bundle with this work.

## 7. Files touched (planned)

| File | Change |
|---|---|
| `server/db.ts` | +3 reset columns (addUserCol) |
| `server/auth.ts` | whitelist + 4 public handlers + rate limiters |
| `server/signatures.ts` | extract `storeSignatureAsset()` |
| `server/index.ts` | wire new routes |
| `src/lib/api.ts` | +4 client methods |
| `src/App.tsx` | +3 public routes |
| `src/pages/JoinPage.tsx` | **new** — 3-step wizard + signature |
| `src/pages/ForgotPasswordPage.tsx` | **new** |
| `src/pages/ResetPasswordPage.tsx` | **new** — OTP/token + confirmation |
| `src/pages/LoginPage.tsx` | forgot/join links |
| `index.html` | viewport meta fix |

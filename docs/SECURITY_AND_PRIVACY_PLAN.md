# ServeTracker Security & Data Privacy Plan

**Document Version:** 2026.3  
**Effective Date:** August 22, 2026  
**Scope:** ServeTracker Application (Internal & Hosted Deployments)

---

## 1. Executive Summary & Philosophy
ServeTracker is an administrative tracking, field attempt logging, and return-of-service generation software application. This plan defines the data governance, encryption standards, access controls, and retention rules implemented to guarantee evidentiary integrity and client confidentiality.

ServeTracker operates on an **honest transparency** model: security is enforced directly through verified cryptographic primitives, role-based isolation, and immutable audit logs rather than third-party marketing attestations.

---

## 2. Data Classification & Inventory

| Data Category | Examples | Storage Location | Sensitivity |
|---|---|---|---|
| **Authentication Data** | Usernames, salted password hashes, session tokens | SQLite (`users`, `sessions`) | Confidential |
| **Case & Recipient Data** | Case numbers, party names, service addresses | SQLite (`client_cases`, `serve_recipients`) | Confidential / Legal Record |
| **Field Attempt Logs** | Timestamps, GPS coordinates, device metadata | SQLite (`serve_attempts`) | Evidentiary Record (Immutable) |
| **Legal Documents & Files** | Court pleadings, stamped affidavits | Local filesystem (`data/documents/`) | High Confidentiality |
| **Photographic Evidence** | Attempt scene photos, restamped EXIF metadata | Local filesystem (`data/uploads/serves/`) | Evidentiary Record |

---

## 3. Cryptographic Standards & Transport Security

1. **In-Transit Encryption:**
   - Enforced via TLS 1.3 with cipher suite `TLS_AES_256_GCM_SHA384`.
   - Strict Transport Security (HSTS) and modern edge routing via Cloudflare.
2. **Password Security:**
   - Passwords hashed using Argon2id with unique cryptographic salts.
   - Zero plaintext password storage. No administrative password recovery backdoors.
3. **Session Management:**
   - 256-bit cryptographically secure pseudorandom tokens (`crypto.randomBytes`).
   - Tokens stored in the database as SHA-256 digests; raw tokens never persist on disk.
   - Cookies issued with `HttpOnly`, `Secure`, and `SameSite=Lax` attributes.
4. **Evidentiary Integrity & Tamper Proofing:**
   - SHA-256 checksums calculated upon creation for all serve attempt snapshots, uploaded pleadings, and executed signature assets.
   - SQLite database triggers (`trg_prevent_attempt_tampering`) abort and raise `EVIDENTIARY_INTEGRITY_VIOLATION` on any direct attempt to modify GPS, timestamps, or attempt order.
   - Photo metadata sanitization: raw camera metadata is stripped to prevent geolocation leakage of the server, followed by strict court-specific tag embedding.

---

## 4. Identity, Roles & Access Control

* **Super Admin / Admin:** Complete administrative management over users, case creation, and client records.
* **Field Server:** Scoped strictly to assigned cases and attempts. Cannot list or inspect unauthorized cases, client directories, or billing records.
* **Public / Unauthenticated:** Access restricted to public landing endpoints (`/login`, `/join`, `/forgot-password`, `/reset-password`, `/terms`, `/privacy`, `/dpa`).
* **Rate Limiting:** Dual-keyed rate limiting (IP + Username) on authentication and password reset routes to prevent brute-force attacks.

---

## 5. Data Retention & Destruction

1. **Active Data:** Maintained throughout the active business life of the deployment.
2. **Deletion Requests:** Case records and client documents can be pruned by authorized administrators. Associated file assets on disk are unlinked immediately upon database deletion.
3. **Database Maintenance:** Automated SQLite `VACUUM` and write-ahead log (WAL) checkpointing ensure deleted records are reclaimed and purged from disk sectors.

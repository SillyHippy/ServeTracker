# ServeTracker Multi-Tenant SaaS Architecture & Isolation Plan

**Document Version:** 1.0 (Draft / Future Feature Branch)  
**Branch Reference:** `feat/multi-tenant`  
**Status:** Isolated on dedicated branch. NOT for deployment to main single-tenant production.

---

## 1. Overview & Objective
This document outlines the architecture for transforming ServeTracker from a single-agency field tracking app into a multi-tenant SaaS platform where multiple independent process-serving agencies (e.g. 6 separate tenant companies) can operate on a shared infrastructure with complete data isolation, customized roles, and tenant-specific preferences.

---

## 2. Core Tenancy Model

### 2.1 Database Hierarchy & Schema Additions
* **`organizations` Table:**
  ```sql
  CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL COLLATE NOCASE,
    created_at TEXT NOT NULL
  );
  ```
* **Tenant Scoping Column (`org_id`):**
  Added with indexes to all primary tables:
  - `users (org_id)`
  - `clients (org_id)`
  - `client_cases (org_id)`
  - `serve_attempts (org_id)`
  - `client_documents (org_id)`
  - `serve_recipients (org_id)`
  - `sessions (org_id)`
  - `audit_logs (org_id)`

### 2.2 Roles & Permissions
* **Super Admin:** Global platform administrator (e.g. system owner). Can view system health, create new tenant organizations, and provision initial company admins.
* **Company Admin (Tenant Admin):** Up to N administrators per organization (e.g. Company A can have 3 admins). Can manage clients, assign cases, invite field servers, and export data within their `org_id` only.
* **Field Server:** Scoped strictly to assigned serves within their organization.

---

## 3. Query Scoping & Security Enforcement

1. **Automatic Query Filtering:**
   All read and write queries enforce tenancy using `orgFilterSql(user, alias)`:
   ```ts
   function orgFilterSql(user: AuthUser, alias = ""): { sql: string; args: string[] } {
     if (user.role === "super_admin") return { sql: "", args: [] };
     const col = alias ? `${alias}.org_id` : "org_id";
     return { sql: ` AND ${col} = ?`, args: [user.orgId || "__none__"] };
   }
   ```
2. **Media & File Path Isolation:**
   - Case documents and serve attempt photos stored in tenant-partitioned subdirectories: `/data/uploads/{org_id}/serves/{serve_id}/`.
   - Direct static file serving is disabled in favor of authenticated endpoint routes (`/api/documents/:id/download`, `/api/serves/:id/photos/:photoId`) that verify the requesting user's `org_id` matches the document's `org_id`.

---

## 4. Tenant-Specific Customizations

| Feature Requirement | Implementation Strategy |
|---|---|
| **Multiple Admins per Company** | Handled natively by role assignment (`role='admin'` paired with `org_id='org_xxx'`). |
| **Dark Mode / UI Themes** | Saved as a per-user preference in `users.theme_pref` (or localStorage), independent of organization. |
| **Custom Off-Site Backups (e.g. OneDrive vs Google Drive)** | Per-tenant backup configuration stored in `organizations.backup_config_json`. Background worker uses tenant-provided OAuth tokens to dispatch snapshots to their chosen cloud provider. |

---

## 5. Automated Verification & Testing Matrix

* **Test Suite:** `tests/org_isolation.test.ts`
* **Test Cases:**
  1. *Tenant A Admin cannot list Tenant B Clients.*
  2. *Tenant A Admin cannot read, update, or delete Tenant B Cases.*
  3. *Tenant A Server cannot view Tenant B Serve Attempts.*
  4. *Unauthorized cross-tenant document download requests return HTTP 403/404.*

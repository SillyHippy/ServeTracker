# ServeTracker Incident Response Plan & Runbook

**Document Version:** 2026.3  
**Effective Date:** August 22, 2026  
**Incident Lead:** System Administrator / Engineering Lead

---

## 1. Purpose & Scope
This Runbook provides step-by-step procedures for detecting, containing, investigating, and mitigating potential security incidents affecting ServeTracker, including unauthorized access attempts, server compromise, data leaks, or service outages.

---

## 2. Incident Classification

| Severity Level | Definition | Response Target | Example |
|---|---|---|---|
| **P1 - Critical** | Active data breach, root server compromise, unauthorized database tampering | Immediate (< 1 Hour) | Database dump leaked, persistent unauthorized admin access |
| **P2 - High** | Service degradation, failed brute-force spikes, credential stuffing against users | < 4 Hours | Massive login rate-limit triggers, email provider disruption |
| **P3 - Medium** | Suspicious field-server activity, isolated application errors | < 24 Hours | Single account lock, invalid attempt hash generated |
| **P4 - Low** | Routine bug reports, non-security UI issues | Normal Sprint | Display glitch on case dashboard |

---

## 3. Incident Handling Lifecycle

```
[ 1. DETECTION ] ───> [ 2. CONTAINMENT ] ───> [ 3. ERADICATION ] ───> [ 4. RECOVERY ] ───> [ 5. POST-MORTEM ]
```

### Phase 1: Detection & Triage
1. Review server logs via `supervisorctl status servetracker-proc` and application logs.
2. Inspect `audit_logs` table in SQLite for anomalous events:
   ```sql
   SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 50;
   ```
3. Check rate-limiting triggers and failed login counts in authentication logs.

### Phase 2: Containment
1. **Compromised User / Admin Account:**
   - Invalidate all active sessions for the user:
     ```sql
     DELETE FROM sessions WHERE user_id = 'compromised_user_id';
     UPDATE users SET is_active = 0 WHERE id = 'compromised_user_id';
     ```
2. **Infrastructure Lockdown:**
   - Temporarily suspend the public process or restrict inbound IP access via Cloudflare Firewall rules if necessary.

### Phase 3: Eradication & Remediation
1. Rotate all API keys and secrets in `.env` (e.g. `SESSION_SECRET`, `RESEND_API_KEY`).
2. Hash and update administrator credentials using Argon2id.
3. Check database integrity and triggers:
   ```sql
   PRAGMA integrity_check;
   ```

### Phase 4: Recovery & Verification
1. Verify database integrity and run automated test suites (`bun test`).
2. Restart application process under supervision.
3. Perform live HTTP/HTTPS sanity probes on health endpoints.

### Phase 5: Notification & Disclosure
- If tenant case records or user PII are confirmed compromised, notify affected stakeholders in writing with a clear timeline, summary of affected data, and remediation steps taken.

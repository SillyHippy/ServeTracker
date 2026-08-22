# ServeTracker Third-Party Vendor Register

**Document Version:** 2026.3  
**Effective Date:** August 22, 2026  

---

## 1. Vendor Inventory & Data Flow Assessment

The following third-party infrastructure and service providers support the ServeTracker deployment. ServeTracker strictly adheres to a principle of data minimization—no case documents or court pleadings are shared with third parties except as required for technical delivery.

| Vendor | Service Provided | Data Accessed | Security Controls | Location / Terms |
|---|---|---|---|---|
| **Cloudflare** | Edge DNS, CDN, WAF, TLS 1.3 Termination, Reverse Proxy | Client IP, Request Headers, Encrypted Payload in Transit | SOC 2 Type II, ISO 27001, TLS 1.3, DDoS mitigation | USA / Global Edge |
| **Resend** | Transactional Email Delivery (Password Resets, Onboarding Invites) | Recipient Email Address, User Display Name, Reset Token | TLS in transit, API token authentication, zero retention of email contents beyond delivery logs | USA |
| **Google Workspace / Drive** | Off-Site Automated Disaster Recovery Backups | Compressed SQLite DB Snapshots, Signature Assets | AES-256 at rest in Drive, Google OAuth 2.0 / API key isolation, SHA-256 round-trip verification | USA (Encrypted Cloud) |
| **Helcim** *(Optional Agency-Level Integration)* | External Client Invoicing & Payment Processing | Payment Card Numbers, Client Billing Name/Email | Direct PCI-DSS Level 1 Processor (Card data NEVER enters or touches ServeTracker) | USA / Canada |
| **Zo Computer VPS Infrastructure** | Linux Host Compute & Host Disk Storage | Application files, SQLite DB (`pdfusaedit.db`), uploaded photos/documents | Containerized isolation, non-root user execution, supervised process management | Host Cloud Container |

---

## 2. Third-Party Exclusions & Boundaries

* **No Data Monetization:** ServeTracker does not integrate advertising SDKs, behavioral analytics, tracking pixels, or data brokers.
* **No In-App Skip Tracing Storage:** External skip-tracing tools (e.g. IRB, FamilyTreeNow) operate completely out-of-band; raw credit header or skip-tracing databases are never ingested into ServeTracker's core schema.
* **No Client Cardholder Data:** ServeTracker does not store, transmit, or process credit card numbers or banking credentials.

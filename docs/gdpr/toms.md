# Operia — technical and organisational measures (TOMs)

The Art. 32 security measures DCA Logic applies to personal data processed in Operia.
This document is **Annex C of every data processing agreement** and the evidence base for
Art. 28(3)(c). It is written for customers and auditors; the code-level map behind every claim
is `../compliance-map.md`.

**Last reviewed:** 2026-08-14 · **Owner:** DCA Logic privacy owner.
Scope: the Operia web app, the Android handheld app, the Supabase backend (`eu-north-1`), the
SFTP/e-mail ingest gateway, and DCA's operational practices.

> **Honesty rule.** §12 lists the measures that are *not* yet in place. A TOMs annex that
> overstates coverage is worse than no annex — it becomes a contractual promise DCA would breach.

---

## 1. Tenant separation

Operia is multi-tenant. The tenant boundary is a `company_id` column on every tenant-owned table,
enforced **in the database** by row-level security, not by application code:
`company_id = current_company_id() or is_platform_admin()`.

- RLS is enabled on every tenant table; the helper functions are `SECURITY DEFINER` and read the
  caller's own identity, so a forged client request cannot widen its own scope.
- Foreign-key lookups bypass RLS, so a trigger re-validates that every referenced receiver,
  department, location and handling class belongs to the same company.
- Columns that only DCA may change (company identity, billing model, entitlements) are protected
  by triggers, because managers and platform admins share one database role.
- **The browser and the handheld are treated as untrusted.** UI gating is cosmetic; every
  privileged operation is re-verified server-side in an edge function or a `SECURITY DEFINER`
  function using the caller's own JWT.

## 2. Access control and authentication

- Individual named accounts; no shared logins. Roles are explicit (`user_roles`), and the web and
  handheld surfaces are gated per role.
- Passwords: Supabase Auth (bcrypt-class hashing, managed), minimum length 8, refresh-token
  rotation, rate limits on auth endpoints. Login errors are generic (no user enumeration).
- **Allowed sign-in methods** are configurable per platform and per company, with database
  constraints that make it impossible to leave a company with no usable method.
- **Passkeys / biometrics**: WebAuthn on web, `androidx.biometric` on the handheld.
  **No biometric data is collected, transmitted or stored** — verification is device-local and
  Operia only ever sees "authenticated" plus a public key.
- **MFA (TOTP)** is enabled in the project configuration; the enrolment UI is still missing
  (§12).
- Platform-admin **impersonation** of a customer user is server-verified, cannot target another
  platform admin, never exposes the auth token to the browser, restores the user's verification
  and last-login state afterwards, is shown as a persistent banner, and is audit-logged
  fail-closed.

## 3. Data minimization and avoidance of special categories

- No special-category data (Art. 9) is processed: no health data, and **no biometric templates**.
- The audit log is minimized at the point of writing: employee numbers instead of names, masked
  recipient addresses, id references in erasure events. The one deliberate exception is the
  manager's free-text reason on an exception event (`receiver_overridden`, `removed`), where the
  reason *is* the audit trail.
- AI label reading logs metadata only — vendor, model, outcome, timing — never the fields read
  and never the image.
- Photos captured on the handheld are deleted from the device cache as soon as they have been
  uploaded or read, with a sweep at app start for anything a crash left behind.
- The web app loads **no CDN, no analytics, no external fonts**. (Exception: a platform
  configured for Google Maps loads Google's Maps JavaScript API in the browser.)

## 4. Confidentiality of the storage layer

- All parcel photos, signatures, asset photos, feedback screenshots and HR imports live in
  **private** Supabase Storage buckets with company-scoped policies. Only `company-logos` and the
  handheld APK bucket are public, and neither holds personal data.
- Deletion of chain-of-custody evidence (condition photos, signatures, asset documentation) is
  restricted to platform admins — deliberately not managers — for evidence integrity; erasure is
  deletion, never rewriting.

## 5. Integrity: immutable audit trail

- `parcel_events` and `audit_log` are **append-only**: UPDATE and DELETE are revoked from client
  roles *and* blocked by trigger. Writing goes through `SECURITY DEFINER` functions whose EXECUTE
  is revoked from clients, so logging can be neither skipped nor forged.
- The only permitted deletion is the retention purge, which runs server-side under a
  transaction-local flag and logs the purge itself.
- Optional **log drains** stream audit events to the customer's own SIEM (HTTP/NDJSON, Datadog,
  Loki) with a delivery watermark that only advances on confirmed delivery.

## 6. Erasure, anonymization and retention

- Employees are **deactivated and anonymized, never deleted** — parcel history references them.
  Anonymization runs through a single server-side function that blanks every identifying field
  and stamps `anonymized_at`; the client never carries the field list.
- Retired employees are anonymized **automatically** when their last parcel reaches a terminal
  status. Asset-loan borrower contact details and notification recipients are cleared the moment
  the asset is returned.
- A daily retention purge enforces the **controller's own retention windows** across eight
  categories (parcels, files, notifications, audit, imports, asset loans, employees, routes),
  resolved as customer value → platform default → keep until further notice. Parcels and their
  files are only removed once **closed**, so a window can never destroy evidence for something
  still in dispute, and employees are anonymized rather than deleted. Every purge is audited.
- Import CSVs are deleted after a successful import; the imports bucket is purged after 30 days.
- Windows that are configurable but currently default to *keep forever* are listed in §12.

## 7. Encryption

- **In transit**: HTTPS/TLS everywhere — browser, handheld, edge functions, storage, and every
  vendor call. SFTP (SSH) for the file gateway, with a persistent host key.
- **At rest**: Supabase/AWS managed encryption for database, storage and backups.
- Credentials at rest: SFTP passwords are bcrypt-hashed server-side; secrets are write-only from
  the client's point of view (the browser sees only a `has_key` boolean).

## 8. Secrets and credential hygiene

- The Supabase **service-role key never leaves the server** — it lives only in edge-function
  environment variables and the Supabase Vault, and is never in the repository or the client.
- Third-party API keys (carriers, AI vendors, maps, SMS, e-mail) are edge secrets only.
- Repository hygiene: `.env` files, the operational password file, the legacy prototype and the
  label test images are gitignored. No personal data is committed.
- Webhook and gateway calls are authenticated with a shared secret in a header (constant-time
  compared, fail-closed), not a query string.

## 9. Ingest security

Employee CSVs contain personal data and arrive from outside, so both routes are hardened:

- **E-mail route**: SPF/DKIM/DMARC verification at two strictness levels, per-company sender
  allowlist (required by default), recipient-domain pinning, filename sanitization, message-id
  deduplication. Spoofing attempts are logged as error-level audit events with the IP.
- **SFTP route**: credentials verified against Operia (bcrypt) on every login, each customer
  chrooted to its own folder, nothing durable stored on the gateway box, admin UI bound to
  localhost, every login and file operation audit-logged with IP and protocol.
- Per-company import lock prevents concurrent-run races.

## 10. Organisational measures

- **Named privacy owner** at DCA Logic (no Art. 37 DPO required at current scale). Reviews are
  dated in each document.
- **Confidentiality**: everyone with access to customer data is bound by confidentiality
  obligations in their employment or consultancy contract.
- **Least privilege**: platform-admin access is limited to staff who need it; impersonation is
  audited (§2).
- **Change control**: all schema changes are ordered migration files in git — never dashboard
  clicks. Compliance-relevant changes update `../compliance-map.md` in the same commit, and a
  standing review question asks whether a change adds a sub-processor or a personal-data field.
- **Sub-processor management**: register maintained in [subprocessors.md](subprocessors.md), with
  a 30-day change notice and an objection right for customers. Each customer maintains its own
  data protection and security contacts in the product (Konfigurér → Databeskyttelse), and the
  signed DPA version is recorded per customer — so a notice or a breach message always has a
  named addressee.
- **Cadence**: quarterly review of the compliance map and the register; ad-hoc review on every
  new external service.

## 11. Availability and resilience

- Managed Postgres with platform backups and point-in-time recovery per plan.
- **Git is the source of truth** for schema, functions, cron jobs and configuration: a complete
  backend can be rebuilt from the repository. The documented recovery procedure, including what
  is *not* in git (secrets, storage objects, dashboard-only settings), is `../disaster-recovery.md`.
- The SFTP gateway is stateless and can be rebuilt from `gateway/` at any time.

## 12. Known limitations (not yet implemented)

Stated openly so the annex stays truthful. Each is tracked in `../compliance-map.md`.

| Limitation | Consequence | Plan |
|---|---|---|
| No MFA enrolment UI | TOTP is available in configuration but users cannot enrol it | Build enrolment UI |
| Handheld session token in plain SharedPreferences | A rooted or ADB-accessible device can read the token; biometric login gates the app, not the token | Keystore-backed session storage |
| Hosted password policy / passkey activation require manual Dashboard settings | Local configuration is not fully reflected in the hosted project | Verify and record in the Dashboard |
| Retention windows all default to *keep until further notice* | Nothing is deleted until a window is set. The mechanism and the screens now exist on both levels across eight categories, but no values are agreed yet | Agree values per customer at onboarding; set the platform defaults |
| ~~`parcel_notifications.recipient` is never cleared~~ | **Fixed 2026-08-14** — cleared when the parcel closes, and backfilled for all closed parcels | — |
| Audit rows written before 2026-07-20 contain names, invitee e-mails and unmasked recipients | The table is immutable, so only the age-based purge can remove them; drained copies are beyond reach | Decide `audit_retention_days` |
| Free-text fields are not scrubbed by anonymization | A third party's name can survive an erasure request | The 13 affected fields are inventoried with a recommendation each in [free-text-fields.md](free-text-fields.md); decisions pending |
| Subject-access export is JSON, not a finished answer | **Built 2026-08-14** (employees and free-text name search). Remaining: image files are listed rather than packaged, sections cap at 500 rows, no PDF rendering | Package files and render a readable document |
| No per-employee notification opt-out | The Art. 21 objection right has no product surface | Planned |
| No verified offboarding runbook or tenant data-return export | End-of-contract deletion is manual | `offboarding.md` |
| Email sub-processors are US-based | A fully EU-only configuration is not yet possible for e-mail | Evaluate an EU sending provider |
| No formal DPA/TIA files with vendors yet | Transfer documentation incomplete | See subprocessors.md §4 open items |

---

## Annex: measure-to-evidence index

| Measure | Where it lives |
|---|---|
| Tenant isolation / RLS | `compliance-map.md` §1 |
| Immutable audit | §2, §3 |
| Log drains | §4 |
| Anonymization / erasure | §5 |
| Retention & minimization | §6 |
| Secrets | §7 |
| Ingest security | §8 |
| Personal-data storage details | §9 |
| Authentication & biometrics | §10 |
| AI label reading | §11 |
| Impersonation | §12 |
| Maps and geocoding | §13 |
| Disaster recovery | `disaster-recovery.md` |

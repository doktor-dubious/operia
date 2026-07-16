# Operia — NIS2 / GDPR compliance map

Where in the codebase NIS2 (security, access control, auditability, log management)
and GDPR (personal-data protection, minimization, retention) are addressed.
Last reviewed: 2026-07-16. Update this file when compliance-relevant code changes.

Legend: **N** = NIS2-relevant, **G** = GDPR-relevant.

## 1. Tenant isolation / RLS (N, G)

The tenant boundary is `company_id` on every tenant-owned table, enforced by RLS —
GDPR data segregation between customers and NIS2 access control in one mechanism.

- `supabase/migrations/20260710031950_core_tenancy.sql` — the backbone: `companies`,
  `app_users`, `user_roles`, `platform_admins`, and the `SECURITY DEFINER` helpers
  `current_company_id()` / `is_platform_admin()` / `has_role()`. Every later
  tenant table repeats the pattern `company_id = current_company_id() or is_platform_admin()`
  (~30 migrations: directory, parcels, carriers, lockers, assets, inventory, routes, …).
- `20260710031953_parcels.sql` — `parcels_guard()` trigger re-validates that FK'd
  receiver/department/location/handling class belong to the same company, because
  FK lookups bypass RLS (cross-tenant-leak prevention).
- `20260712044648_protect_company_identity.sql` + part of `20260712145032_review_hardening.sql`
  — triggers blocking managers from mutating DCA-owned columns (name/CVR, billing
  model) that column grants can't protect, since managers and platform admins share
  the `authenticated` DB role.
- `web/src/hooks/use-access.ts`, `web/src/lib/nav.ts`, route guards in
  `_app.tsx` / `operia.tsx` / `configure.tsx` — UI gating (explicitly cosmetic;
  RLS is the enforcement). Destructive UI flows verify returned row counts to
  detect RLS denials (`employees.tsx`, `operia.users.tsx`).

## 2. Immutable audit trail (N)

- `20260710031953_parcels.sql` — `parcel_events` is the chain-of-custody log:
  append-only (UPDATE/DELETE revoked **and** trigger-blocked via `block_mutation()`),
  written only by a `SECURITY DEFINER` trigger, deliberately no FKs so cascades can
  never rewrite history.
- `20260711124521_audit_log.sql` — the central log ("NIS2-revisionslog"): same
  immutability treatment; `record_audit()` is execute-revoked from client roles so
  logging can be neither skipped nor forged. GDPR detail: `employee.anonymized`
  events reference only `employee_no`/`id`, never the erased personal data.
- `20260710134424_employee_import.sql` — `import_runs` append-only by policy;
  doubles as the manager alert surface for malformed imports (spec Flow 0).
- `20260715110000_retention_policy.sql` — `block_mutation()` admits DELETE only
  under the transaction-local GUC set by `run_retention_purge()` (see §6);
  clients still lack the DELETE privilege entirely.

## 3. Audit coverage (N)

Server-side `SECURITY DEFINER` triggers write every auditable change to `audit_log`:

- Core entities: employees, departments, locations, handling classes, carriers,
  lockers, app_users, import runs, parcel events (`20260711124521_audit_log.sql`).
- Config surfaces, one migration each: carrier agreements incl. `key_replaced`
  (`20260712080647`), entitlements (`20260712080741`), templates (`20260712080922`),
  catalog (`20260712081655`), localization (`20260712082835`), platform assets
  (`20260712112302`), appearance/texts (`20260713190000`), billing/shipping + parcel
  flow (`20260712145032` — "what a disputed rate change must be traceable on"),
  masterdata renames (`20260714140000`), data-transfer settings & credentials
  (`20260714090000` ff. — values never logged), retention policy (`20260715110000`).
- Taxonomy: `audit_category()` / `audit_level()` generated columns
  (`20260713120000`, unioned in `20260716100000_audit_category_union.sql`);
  client mirror is `categoryOf`/`levelOf` in `web/src/routes/_app/operia.logs.tsx`
  — keep in sync.
- Viewers: `web/src/routes/_app/operia.logs.tsx` (platform admin, facets/histogram/
  CSV export; actor emails only via platform-admin-gated `admin_user_emails()`),
  `web/src/components/import/module-import-log.tsx` (manager-facing import trail).
- Gateway events: `log_gateway_event()` (`20260714120000`) is the service-role-only
  entry point edge functions use to log `data_transfer.*` (logins, uploads,
  deletes, spoof rejections) with IP/protocol.

## 4. Log drain / SIEM forwarding (N)

NIS2 selling point: customers ship their audit events to central log management.

- `20260714130000_log_drains.sql` — per-company and platform-level drains
  (HTTP/NDJSON, Datadog, Loki); write-only `secret` column (`secret_set` indicator);
  delivery watermark starts at current max (no historical dump); config changes
  audited without the secret.
- `20260714130500_log_drains_secret_lockdown.sql` — revokes the auto-granted
  table-wide SELECT that would have exposed `secret`.
- `20260714131000_log_drains_cron.sql` — pg_cron dispatch every minute; service-role
  key read from Supabase Vault, never git.
- `supabase/functions/log-drain-dispatch/index.ts` — dispatch requires service-role;
  test mode re-verifies drain ownership via the caller's JWT (RLS) before the
  service-role reads the secret; watermark advances only on confirmed delivery.
- UI: `web/src/components/log-drains/log-drains-manager.tsx` (+ company/platform/
  per-customer wrappers).

## 5. GDPR anonymization / deactivate-instead-of-delete (G)

Employees must survive as rows (parcel history / chain of custody references them);
personal data is removed instead.

- `web/src/routes/_app/employees.tsx` — Deactivate keeps the row; **Anonymize (GDPR)**
  permanently blanks name/initials/email/phone/employee_no, stamps `anonymized_at`
  (checkbox + typed confirm word, bulk supported); hard delete is platform-admin-only
  (test-data cleanup).
- `supabase/functions/_shared/employee-import.ts` — Flow 0 import deactivates
  employees missing from the CSV (never deletes) and never touches manually
  created (`is_manual`) rows.
- FKs like `parcels.receiver_employee_id` are `on delete set null` — removing a
  person never destroys operational history.

## 6. Retention & data minimization (G, N)

- `20260715110000_retention_policy.sql` — platform-set retention windows
  (`platform_settings.audit_retention_days` / `import_retention_days`, NULL =
  keep forever, **default off**). `run_retention_purge()` (service-side only,
  daily pg_cron `operia-retention-purge` 03:40 UTC) deletes expired `audit_log`,
  `import_runs`, `inbound_files` rows and logs `retention.purged` so the purge
  itself is traceable. `parcel_events` is deliberately excluded (chain of custody
  follows the parcel's lifecycle). Policy changes are audited (`retention.changed`).
  No settings UI yet — set via SQL on `platform_settings`.
- `supabase/functions/_shared/import-runner.ts` — deletes the source CSV (personal
  data) from Storage after a successful import; kept only on reject/failure for
  inspection. `20260716090000_data_transfer_hardening.sql` schedules a daily
  `imports-cleanup` (function pending) for stragglers.
- `web/src/components/company-config-fields.tsx` (`cleanupLogos`) — removes all
  files in a company's public `company-logos` folder except the current logo
  (replaced logos must not stay publicly reachable); called on logo save
  (`configure.logo.tsx`) and customer delete (`operia.customers.tsx`). Storage
  grants: `20260712013427`, `20260712043603`.

## 7. Secrets & credential handling (N)

- Universal write-only-secret pattern: carrier `api_key` (`20260712075958` +
  `20260712080044_carrier_agreements_key_lockdown.sql`), SFTP password, log-drain
  secrets — browser only ever sees `has_key`/`*_set` booleans.
- `20260714100000_sftp_password_hash.sql` — SFTP passwords bcrypt-hashed server-side
  in a `SECURITY DEFINER` RPC (NIS2: no cleartext credentials at rest).
- `20260714090000_data_transfer.sql` — customer-editable config split from the
  platform-admin-only `company_data_transfer_secret` table.
- `supabase/functions/invite-user/`, `create-customer/` — re-verify the caller's
  JWT + role server-side before any service-role provisioning (the browser is
  untrusted).
- Repo hygiene: root `.env`, `web/.env`, `docs/operia.txt`, `prototype/`,
  `gateway/.env` are gitignored; service-role key lives only in edge-function
  env + Supabase Vault. `gateway/.env` must be `chmod 600` (see gateway README).

## 8. Data-transfer ingest security (N, G)

Employee CSVs (personal data) arrive over SFTP or email; both legs are hardened:

- `supabase/functions/email-inbound/index.ts` — SPF/DKIM/DMARC anti-spoofing (two
  strictness levels), per-company sender allowlist enforced after the spoof check,
  platform+company enable toggles, recipient-domain pinning, filename sanitization
  (path traversal); spoof rejections logged as error-level
  `data_transfer.spoof_rejected`. Settings migrations: `20260714170000`–`20260714200000`
  (allowlist required is secure-by-default on).
- `supabase/functions/sftp-auth/` + `sftp-uploaded/` + `20260714110000_sftp_gateway.sql`
  — bcrypt credential check via service-role-only RPC; every customer chrooted to
  `imports/{company_id}/`; logins and file operations audit-logged with IP/protocol.
- Hook authentication: `supabase/functions/_shared/hook-auth.ts` — shared secret
  accepted as `X-Operia-Hook-Secret` header (SFTPGo, via `SFTPGO_HTTPCLIENT__HEADERS`
  in `gateway/docker-compose.yml`) or HTTP basic-auth password (Postmark webhook
  URL), constant-time compared, fail-closed; legacy `?token=` still accepted —
  remove from URLs once header delivery is verified in production.
- `20260716090000_data_transfer_hardening.sql` — per-company import lock (no
  concurrent-run races) + `message_id` dedup for at-least-once email delivery.
- `gateway/` — stateless SFTPGo box: nothing durable stored locally, admin UI
  bound to localhost, host key persisted for a stable SSH fingerprint.

## 9. Personal-data storage details (G)

- `20260710090929_carriers_and_photos.sql` — private `parcel-photos` bucket,
  company-scoped storage RLS (condition photos = chain-of-custody evidence).
- `20260711020755_employee_extended_fields.sql` — `nfc_card_id` (personal
  identifier used at handover), unique per company.
- Android (scaffold): `allowBackup="false"`; no local personal-data storage;
  only the public anon key is embedded — RLS is the access control.

## 10. Authentication (N)

- `web/src/routes/_app.tsx` (session guard), `login.tsx` (generic error — no user
  enumeration), `welcome.tsx` (invite/set-password, min length 8),
  `web/src/lib/password.ts` (CSPRNG generation).
- `supabase/config.toml` — refresh-token rotation, auth rate limits,
  `minimum_password_length = 8` (mirror in the hosted project: Dashboard → Auth →
  Passwords). MFA (TOTP) present but disabled — see gaps.

## Known gaps / roadmap

| Gap | Status |
|---|---|
| MFA + Entra ID SSO (NIS2 requirement per spec §security) | **Open** — TOTP disabled in `config.toml` (needs Supabase Pro), no enrollment UI, no SSO. Planned. |
| Retention settings UI | **Open** — mechanism live (§6) but platform admins must set windows via SQL. |
| Hosted password policy | **Open** — `config.toml` raised to 8 (2026-07-16) but the hosted project's Auth → Passwords setting must be raised manually in the dashboard. |
| `?token=` removal from hook URLs | **Pending verification** — header/basic-auth deployed and verified 2026-07-16; drop the query fallback from `gateway/docker-compose.yml` and the Postmark URL after the next gateway redeploy. |
| `gateway/.env` file permissions | **Fixed on the current box** (600, 2026-07-16) + README instruction; re-check on any new deployment. |
| `parcel-photos` lifecycle | **Open** — condition photos have no automated retention/deletion. |
| Anonymization of free text | **Open** — employee anonymization blanks the row, but names may survive in free-text fields (parcel notes, sender). No sweep exists. |
| `imports-cleanup` edge function | **Open** — cron scheduled (`20260716090000`), function not yet implemented. |

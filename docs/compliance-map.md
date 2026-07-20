# Operia — NIS2 / GDPR compliance map

Where in the codebase NIS2 (security, access control, auditability, log management)
and GDPR (personal-data protection, minimization, retention) are addressed.
Last reviewed: 2026-07-20. Update this file when compliance-relevant code changes.

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

- `20260720120100_entra_retire_anonymize.sql` + `20260720130000_gdpr_anonymize_hardening.sql`
  + `20260720150000_review_fixes_entra_gdpr.sql` — `anonymize_employee_internal(uuid, text)`
  is the **single** server-side erasure implementation: blanks full_name/first_name/
  last_name/initials/email/phone/nfc_card_id/employee_no/role/external_id/user_id,
  stamps `anonymized_at`. Returns whether the employee had a login, because
  `app_users`/`auth.users` still hold name+email and must be removed separately under
  Users. It is not callable from clients; `anonymize_employee` is the RPC shell that
  adds the authorization check (platform admin, or `manager`/`data_manager` in the
  employee's company), and the trigger/sync paths call the internal function directly —
  the role check must not apply to the parcel handler whose handover merely *triggers*
  a policy-driven anonymization.
- `web/src/routes/_app/employees.tsx` — Deactivate keeps the row; **Anonymize (GDPR)**
  calls `anonymize_employees(uuid[])` (checkbox + typed confirm word) and warns when a
  login account remains; hard delete is platform-admin-only (test-data cleanup). Bulk
  runs as **one transaction** — all selected employees are anonymized or none, so a
  mid-batch failure can't leave an unknowable mix of erased and intact rows. Until
  2026-07-20 this dialog wrote its own column list and silently left first_name,
  last_name, nfc_card_id and role behind — keep erasure logic in the RPC, not the client.
- Retirement lifecycle (AD): employees who leave the directory with parcels still open
  are deactivated and prefixed `EX-` so managers can sort the remainder out, then
  anonymized automatically when the last parcel reaches a terminal status
  (`retire_employee` / `unretire_employee` / `sweep_retired_employees`, trigger
  `parcels_anonymize_retired_receiver`). Anonymization clears `external_id`, so a person
  who returns after erasure comes back as a new employee — by design.
- `20260720130100_asset_loan_anonymize.sql` — `asset_loans` is a standalone borrower
  contact copy (no `employee_id`), so employee anonymization could never reach it.
  A loan's name/address/email/phone and its `asset_loan_notifications.recipient` values
  are cleared the moment `returned_at` is set (trigger `asset_loans_anonymize_on_return`);
  `sweep_returned_loans()` backfilled the history. The contact-required check now exempts
  anonymized rows.
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
- `20260720130200_parcel_files_retention.sql` + `supabase/functions/parcel-files-cleanup/`
  — the `parcel-photos` and `signatures` buckets previously had **no** DELETE policy at
  all, so no one could erase a condition photo or a handover signature (an image of a
  person's handwriting), and files were orphaned whenever a parcel or company was
  deleted. Now: DELETE policies scoped to platform admins (deliberately not managers —
  photos and signatures are chain-of-custody evidence, same reasoning as immutable
  `parcel_events`), plus a daily cron `operia-parcel-files-cleanup` that removes
  orphaned files unconditionally and aged files once
  `platform_settings.parcel_files_retention_days` is set (NULL = keep forever).
  The age rule only applies to files whose parcel is **closed**
  (delivered/rejected/returned) — an open or disputed parcel keeps its condition
  photos and signatures regardless of age, so the retention window can never destroy
  evidence for something the system still tracks.
  Purges are audited as `retention.files_purged`, and only when something was removed.
- Feedback screenshots (`20260720150000_review_fixes_entra_gdpr.sql`) — the private
  `feedback` bucket now has a deletion path mirroring the parcel files: DELETE policies
  for platform admins on both the `feedback` row and the screenshot object, and the
  daily cleanup job removes screenshots whose feedback row no longer exists (with a
  one-day grace period, since the file is uploaded before the row is inserted). An
  erasure request covering a screenshot is honored by deleting the feedback row.
- Audit-log minimization: names and recipient addresses are kept **out** of `audit_log`
  in the first place, since it is UPDATE/DELETE-blocked and forwarded to log drains —
  `audit_employees()` logs `employee_no`, `lend_asset`/`update_asset_loan` no longer log
  the borrower, and the notification dispatchers mask recipients via `maskRecipient()`
  (`supabase/functions/_shared/notify.ts`).
- `supabase/functions/_shared/import-runner.ts` — deletes the source CSV (personal
  data) from Storage after a successful import; kept only on reject/failure for
  inspection. `supabase/functions/imports-cleanup/index.ts` (daily, scheduled in
  `20260716090000_data_transfer_hardening.sql`) purges `imports` bucket objects older
  than 30 days for stragglers.
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
| `parcel-photos` / `signatures` lifecycle | **Fixed 2026-07-20** (§6) — DELETE policies + daily orphan/retention purge. Retention window still defaults to NULL (keep forever) and has no UI. |
| `imports-cleanup` edge function | **Done** — implemented; 30-day purge of the `imports` bucket. |
| Anonymization of free text | **Open** — `parcels.delivered_to` / `delivered_note` hold the free-text name of whoever collected a parcel (often a proxy, i.e. a third party) and are not cleared by any anonymization path. The signature image is now purgeable but the name beside it is not. Decide: scrub on anonymize, or document the retention as chain-of-custody evidence. |
| Personal data already in `audit_log` | **Open** — new writes are minimized (§6), but rows written before 2026-07-20 still contain employee names, `EX-<name>` retirement entries, invitee emails and unmasked recipients. The table is UPDATE/DELETE-blocked, so only the global age-based purge can remove them — and `audit_retention_days` defaults to NULL. Copies already delivered to log drains are beyond reach. |
| Notification recipient logs | **Open** — `parcel_notifications.recipient` and `asset_loan_notifications.recipient` store the literal email/MSISDN of every message sent. Loan recipients are now cleared on return (§5); parcel ones are not, and neither table has a retention window. |
| Right of access (Art. 15) | **Open** — no per-employee data export. `import.export.tsx` is bulk masterdata for active employees only, so it cannot answer a subject access request. DCA is a processor and owes controllers assistance here (Art. 28(3)(e)). |
| Consent / legal basis / opt-out | **Open** — no consent column, no legal-basis record, no per-employee notification preference or opt-out. Notification toggles exist only at platform and company level; the data subject has no control. |
| Per-company retention | **Open** — retention windows live on `platform_settings` only, so the customer (the actual controller) cannot set its own. Nothing has a window for `parcels`, `parcel_events` (deliberately), notifications, `asset_loans` or `employees`. |
| Processor agreements / transfers | **Open** — personal data leaves to Resend (name + email + barcode; US), Postmark (holds inbound HR CSVs; US), GatewayAPI (phone numbers; DK), OpenRouteService (addresses) and any customer-configured log drain. No DPA/subprocessor list or transfer mechanism is recorded in the repo. Web side is clean: no CDN, analytics or external fonts; only OSM tiles on the routes page. |

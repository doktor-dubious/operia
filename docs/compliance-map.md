# Operia — NIS2 / GDPR compliance map

Where in the codebase NIS2 (security, access control, auditability, log management)
and GDPR (personal-data protection, minimization, retention) are addressed.
Last reviewed: 2026-08-14 (§§11–13 + gaps); previous full review 2026-07-20.
Update this file when compliance-relevant code changes.

Legend: **N** = NIS2-relevant, **G** = GDPR-relevant.

**Two layers.** This file is layer 1: the engineering truth, referenced to code.
Layer 2 — the formal, customer- and auditor-facing documents — lives in
[`docs/gdpr/`](gdpr/): [`subprocessors.md`](gdpr/subprocessors.md) (the Art. 28(2)
register and transfer bases), [`ropa.md`](gdpr/ropa.md) (the Art. 30(2) record) and
[`toms.md`](gdpr/toms.md) (the Art. 32 measures, Annex C of every DPA). They reference
this map but never require reading code. Anything added here that touches a new
recipient, purpose or personal-data field must be reflected there in the same commit.

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
- `20260730100000_receiver_override.sql` — manager override of the receiver writes
  its own `receiver_overridden` row (actor + intended/actual receiver ids + reason)
  into `parcel_events`, so a deviation from the intended chain of custody is part of
  the append-only trail; `audit_parcel_events()` mirrors it to `audit_log` as
  `parcel.receiver_overridden`, classified `warning` by `audit_level()`.
- `20260730120100_parcel_removal.sql` — a mis-registered parcel is **voided, never
  deleted**: status `removed` plus a `removed` row in `parcel_events` (actor, reason)
  and `parcel.removed` in `audit_log`, classified **`error`** by `audit_level()` — the
  hardest event in the parcel flow, since a registration is being withdrawn. Only
  manager/parcel_manager (or platform admin) can call `remove_parcel()`, a reason is
  mandatory, and closed parcels (delivered/returned) cannot be voided.
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
- `20260730120100_parcel_removal.sql` — `employee_has_open_parcels()` and
  `anonymize_on_parcel_closed()` count `removed` as closed, so voiding a mis-registered
  parcel releases a pending erasure instead of blocking it forever.
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
- `20260801180000_asset_documents_erasure.sql` — asset flow notes and photos live in
  `asset_documents` precisely so they stay erasable (free text may contain personal
  data; the immutable `asset_events` log holds only id references) — but the table
  originally revoked UPDATE/DELETE with no erasure path at all. Now: DELETE policies
  scoped to platform admins on both the `asset_documents` row and the `asset-photos`
  object (deliberately not managers — documentation is evidence, same reasoning as the
  parcel files above), surfaced as a delete button on the document lists in the web app.
  UPDATE stays revoked for everyone: erasure is deletion, never rewriting. Every
  deletion is written to the asset's history (`asset.document_deleted`, id references
  only) and mirrored to `audit_log`.
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
- `web/src/lib/company-files.ts` (`cleanupCompanyFiles`) — removes everything in a
  company's folder in the public `company-logos` bucket (Home-/Handheld-design
  images) when the customer is deleted, so nothing stays publicly reachable after
  the tenant is gone; called from `operia.customers.tsx` (single + bulk delete).
  Storage grants: `20260712013427`, `20260712043603`. Replaced the older
  `cleanupLogos` when the per-company logo/appearance editors were removed
  (2026-07-28) — there is no longer a "keep the current logo" case, and files are
  only purged on delete, not on every save.

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
- `20260730100000_receiver_override.sql` — `parcels.delivered_employee_id` (FK to the
  actual receiver) plus `receiver_override_reason` (manager free text, may name a
  third party), `receiver_override_by`/`_at`. Only manager/parcel_manager (or a
  platform admin) can write them, via `override_parcel_receiver()`. The reason shares
  the open question below with `delivered_to`/`delivered_note`: it is not scrubbed by
  any anonymization path today.
- `20260730120100_parcel_removal.sql` — `parcels.removed_reason` (manager free text),
  `removed_by`/`_at`; same un-scrubbed free-text caveat as the row below.
- Android: `allowBackup="false"`; only the public anon key is embedded — RLS is the
  access control. The only personal data that ever touches the device's own storage is a
  camera capture in `cacheDir/captures`, deleted the moment it has been read and swept at
  app start (§11). The session token in SharedPreferences remains the open item (gaps).

## 10. Authentication (N)

- `web/src/routes/_app.tsx` (session guard), `login.tsx` (generic error — no user
  enumeration), `welcome.tsx` (invite/set-password, min length 8),
  `web/src/lib/password.ts` (CSPRNG generation).
- `supabase/config.toml` — refresh-token rotation, auth rate limits,
  `minimum_password_length = 8` (mirror in the hosted project: Dashboard → Auth →
  Passwords). MFA (TOTP) present but disabled — see gaps.
- **Allowed sign-in methods** (`20260804044212_login_security_settings.sql`):
  `platform_settings.login_password_enabled` / `login_biometric_enabled` with
  nullable per-company twins on `companies` (effective = platform AND
  `coalesce(company, true)`; a company can narrow, never widen). Edited on
  `/operia/login-security` and `/configure/login-security`; read pre-login by the
  `get_login_options()` RPC (anon-executable, exposes only those two booleans).
  A DB check constraint on both tables prevents disabling every method.
  Per-row checks cannot see both levels at once, so
  `20260804053046_login_methods_cross_level_guard.sql` adds deferred constraint
  triggers on both tables rejecting any change that would leave a company with
  no usable method (two individually-legal edits could otherwise combine into a
  lockout).
  **The password flag gates UI only** — GoTrue cannot refuse a password grant
  per company on the current plan (the password-verification hook is
  unavailable, §3). **The biometric flag is enforced**: `login.tsx` re-checks
  the signed-in user's company after the passkey ceremony and signs them back
  out if the company disabled it, and enrollment re-checks the live value.
- **Biometric sign-in** — web uses Supabase passkeys/WebAuthn
  (`registerPasskey` / `signInWithPasskey`, experimental opt-in in
  `web/src/lib/supabase.ts`; enrollment UI in `web/src/components/passkey-section.tsx`);
  the handheld uses `androidx.biometric` (`android/.../data/Biometrics.kt`) to lock
  the already-persisted supabase-kt session behind the device prompt.
  **Biometrics is device trust, NOT personal identification** (verified on an
  emulator 2026-08-04 with two enrolled fingerprints): Android's
  `BiometricPrompt` returns only "authenticated", never *which* enrolled finger
  matched, and enrolment is device-level rather than per Operia user. A second
  person who enrols their finger on a shared handheld can therefore sign in as
  whichever account that terminal remembers, and subsequent `parcel_events` are
  attributed to the remembered user. Chain-of-custody consequence: a handheld
  offering biometric sign-in should be treated as a **personal** device (one
  person's biometrics enrolled), or biometrics disabled for that customer via
  `/configure/login-security`. The password path is unaffected.
  **GDPR-relevant: no biometric data is collected, transmitted or stored by
  Operia.** Verification happens entirely on the device; Supabase holds only a
  WebAuthn public key, and the handheld stores only a local boolean
  (`LocalStore.biometric_login`). The device — not Operia — decides whether the
  check is fingerprint, face or device PIN, so the two are not separable
  settings. Web passkeys additionally require Dashboard → Authentication →
  Passkeys (see gaps).

## 11. AI label reading (G, N)

Added 2026-08-06, disclosure + audit trail 2026-08-12. This is the only feature that
sends customer personal data to a general-purpose AI vendor, so it gets its own section.

- **What leaves the building**: `supabase/functions/ai-read-label/index.ts` posts the
  full label photo (base64) to the customer's chosen vendor — Anthropic (US) via
  `npm:@anthropic-ai/sdk`, Google Gemini (US) via `generativelanguage.googleapis.com`,
  or Mistral (FR) via `api.mistral.ai/v1/ocr`. The photo carries receiver **and**
  sender name, address and phone. Both clients downscale to ≤1600 px JPEG first
  (`ai-label-scan.tsx`, `PhotoHelpers.kt`).
- **Mistral is the only vendor that keeps the photo inside the EU/EEA** (added
  2026-08-12, `20260812150000_ai_mistral_ocr.sql`): Mistral AI SAS is French, hosted in
  the EU and outside the US CLOUD Act, so no third-country transfer takes place. The
  disclosure therefore has two transfer sentences, picked by `AiProvider.outsideEu`:
  `companyAi.disclosureTransfer` (third country, needs a transfer basis) vs
  `companyAi.disclosureTransferEu`. Its model `mistral-ocr-latest` is a document model,
  not a chat model — the fields come back via `document_annotation_format`, and the
  field *descriptions* carry the extraction rules (`FIELD_HINTS` in the edge function).
- **Nothing is stored server-side**: no bucket write, no table. The extracted values
  persist only as ordinary parcel fields, and only after a human applies them. The
  matching layer (`20260807132720_ai_label_matching.sql`, `ai_match_label_fields()`)
  is pure in-DB text comparison — `SECURITY INVOKER`, RLS applies, nothing leaves.
- **Three-level opt-in**: `platform_settings.ai_enabled` (DCA, default false) →
  `company_ai_config.provider/model` (customer) → `company_ai_config.disclosure_accepted`
  (customer's confirmed disclosure). The edge function re-checks all three server-side
  and returns `not_accepted` when the last is missing.
- **The disclosure is the customer's documented instruction (Art. 28)**:
  `20260812104500_ai_label_read_audit.sql` + `20260812120000_ai_disclosure_grant.sql`.
  It can only be granted through `accept_ai_disclosure(company, provider, version)`,
  which rejects a provider or text version other than the one shown; a plain table
  write can only *keep* an unchanged acceptance or withdraw it, so a provider switch
  (e.g. US → CN) always drops it. Timestamp, user and version are stamped by
  `stamp_ai_disclosure()`, never by the client (column-level grants keep the evidence
  columns server-owned). Events: `ai.disclosure_accepted` / `ai.disclosure_withdrawn`.
  Text: `companyAi.disclosure*` in `web/src/i18n/locales/*.json`, vendor/country from
  `AI_PROVIDERS` in `web/src/lib/ai.ts`, one-liner repeated in the scan dialog and on
  the handheld's receive screen.
- **Audit trail per read (Art. 30)**: every call — success, rejection and error alike —
  writes `ai.label_read` via `record_ai_label_read()` (service-role only). Content
  minimization is enforced by the function itself, not by convention: provider, model,
  outcome and source must match narrow patterns or become `unknown`, numbers are
  clamped, `summary`/`entity_id` stay empty. **The read fields, the image and the
  vendor's error text are never logged** — `audit_log` is immutable and forwarded to
  customer log drains, so anything personal written there can never be erased. The
  vendor error text goes to the function's own (short-lived) log only.
  Logs taxonomy: category `ai`, level from the outcome (`audit_level()`).
- **Nothing is left on the device either** (2026-08-14): the handheld deletes the
  captured label photo from `cacheDir/captures` as soon as `readScaledJpeg` has it in
  memory, and on a cancelled capture (`deleteCapture()` in `PhotoHelpers.kt`, wired into
  `ReceiveScreen` label + per-parcel photos, `ConditionScreen`, `AssetDocumentScreen`).
  Only our own FileProvider URIs are touched — a gallery URI points at the user's own
  picture and must not be deleted — and the filename is normalized against the captures
  directory so a manipulated URI cannot escape the cache. `sweepCaptures()` in
  `MainActivity.onCreate` clears anything a crash or a camera app that never returned
  left behind.
- **Free tiers are development-only** (`hasFreeTier` in `web/src/lib/ai.ts`): Google's
  Gemini free tier and Mistral's free "Experiment" plan both allow the vendor to use
  submitted content for model improvement, so a key on those plans may only see
  synthetic labels. Operia → Integrationer shows the warning next to the provider
  before a platform admin exposes it to customers
  (`integrationsPage.aiFreeTier*`). Anthropic has no free API tier. The production rule
  is written down in [`docs/gdpr/subprocessors.md`](gdpr/subprocessors.md) §2.
- Fixtures: `supabase/tests/ai_label_audit.sql` (runs in a rolled-back transaction).
- Test labels: `docs/labels/` is **gitignored since 2026-08-14** and untracked. Label
  photos are exactly the data category this feature processes, so they stay out of the
  repository even though the current set is synthetic. (They were committed between
  2026-08-06 and 2026-08-13 and remain in git history — see gaps.)

## 12. Platform-admin impersonation (N, G)

The broadest access path in the system: a DCA platform admin signing in **as** a customer
user to reproduce a reported problem. Built 2026-07-28,
`supabase/functions/impersonate-user/index.ts` + `20260728*_impersonation*.sql`.

- **Server-side authorization, twice**: the caller's own JWT must resolve to a platform
  admin, and the target must **not** be one (an admin cannot borrow another admin's
  identity). The browser is untrusted; the UI button is cosmetic.
- **The token never reaches the client**: the function generates a magic link with the
  service-role key *without sending mail* and redeems it inside the function, returning
  only the finished session tokens.
- **No false signals in the user's own record**: GoTrue stamps `email_confirmed_at` and
  `last_sign_in_at` on redemption, so `impersonation_restore_auth_state` puts the previous
  values back — an impersonation must not look like the user's own login or invite accept.
- **Visible and logged**: a cross-tab amber banner runs for the whole session
  (`web/src/components/impersonation-banner.tsx`), and the action is written to `audit_log`
  fail-closed with the target's **masked** e-mail (`maskRecipient()`), so the evidence
  itself does not become a new personal-data leak.
- GDPR framing: this is DCA-as-controller processing for service delivery — recorded in
  [`docs/gdpr/ropa.md`](gdpr/ropa.md) §15.

## 13. Maps, geocoding and route planning (G)

- `supabase/functions/route-calc/index.ts` — two selectable providers:
  **OpenRouteService** (HeiGIT gGmbH, DE — the default, `api.openrouteservice.org`) and
  **Google** (`maps.googleapis.com/maps/api/geocode`, `routes.googleapis.com`), active as a
  choice since `20260731100000`. Either way the **addresses** on the route (employee and
  delivery addresses) leave the platform; with ORS they stay in the EU, with Google they
  go to the US.
- **The "no external requests" claim no longer holds for Google-configured platforms**: the
  browser itself loads the Maps JavaScript API from Google when Google is the provider, so
  the user's IP reaches Google directly. Google's ToS forbids drawing Google data on OSM
  tiles, which is why there are two renderers rather than one. The ORS default keeps the
  no-third-party-in-the-browser property intact.
- API keys are edge secrets (`ORS_API_KEY`, `GOOGLE_MAPS_API_KEY`); the Google **browser**
  key is necessarily public and must therefore be referrer-restricted.
- Recorded in [`docs/gdpr/ropa.md`](gdpr/ropa.md) §8 and
  [`subprocessors.md`](gdpr/subprocessors.md) rows 8–9.

## 14. GDPR-kontakter og databehandleraftale pr. kunde (G)

Added 2026-08-14, `20260814100000_privacy_contacts_dpa.sql`. Two DPA obligations
were unfulfillable because `companies` held no contact field at all: Art. 28(2)
(30-day sub-processor change notice — *to whom?*) and Art. 33(2) (breach
notification without undue delay — *who is called at 03:00?*).

- **Two contact blocks** (`privacy_contact_*`, `security_contact_*`) — the
  customer's own data, maintained by a manager on `/configure/privacy`
  (`web/src/components/company-privacy-fields.tsx`, shared with the platform side).
- **The DPA record** (`dpa_version`, `dpa_signed_at`, `dpa_signed_by`) is DCA's
  evidence that the agreement was in force *before* processing began, so it is
  DCA-owned: `protect_company_dca_columns()` was extended to reject a manager
  writing it, exactly like company name/CVR and the shipping model. The UI mirrors
  this (read-only without `admin`), but the database is the enforcement. A check
  constraint (`companies_dpa_record_complete`) refuses a signature date without a
  version and a signatory — a half record is not evidence.
- **Audit without new PII**: `audit_company_privacy()` writes
  `privacy.contacts_changed` with the **names of the changed fields** plus two
  booleans (is a contact set at all) — never the contact's name, e-mail or phone,
  because `audit_log` is immutable and forwarded to log drains.
  `privacy.dpa_changed` logs version and date (contract data, not personal data)
  but only a `signatory_changed` flag for the person's name. Verified against the
  live database 2026-08-14 in a rolled-back transaction.
- Taxonomy: `privacy.*` → new category `compliance`; the client mirror is
  `categoryOf`/`CATEGORIES` in `operia.logs.tsx` — kept in sync.
- Referenced by [`docs/gdpr/dpa/bilag-da.md`](gdpr/dpa/bilag-da.md) B.2, C.1 and
  D.1: the annexes point at these screens as the place where the instruction and
  the notice addresses live.

## 15. Per-company retention (G)

Added 2026-08-14, `20260814140000_retention_per_company.sql`. Retention was
platform-level, SQL-only and covered three tables — which made DCA, not the
customer, the one deciding how long the *controller's* data lives. Now:

- **Eight categories** (`parcels`, `parcel_files`, `notifications`, `audit`,
  `imports`, `asset_loans`, `employees`, `routes`) resolved as **customer value →
  platform default → keep forever** by `retention_days(company, category)`, the
  single place the UI, the purge and the cleanup function all read. The function
  is `SECURITY DEFINER` and therefore guards itself: a signed-in user may only ask
  about their own company (platform admins about all), while the service role —
  which has no `auth.uid()` — passes, because the daily file cleanup looks the
  window up per company folder.
- **`run_retention_purge()` rewritten** to loop companies × categories. Order
  matters inside a company: `parcel_events` has `on delete restrict` against
  `parcels`, so the history is deleted explicitly *before* the parcel — both only
  possible under the `operia.retention_purge` GUC. Photos and signatures become
  orphans and are swept by the existing daily job.
- **Only closed parcels** are ever deleted by a window (delivered/rejected/
  returned/removed), so a window can never destroy evidence for something still
  in dispute. **Employees are anonymized, never deleted**, and only when they have
  no open parcels.
- **`parcel_notifications.recipient` is now cleared when the parcel closes**
  (trigger `parcels_clear_notification_recipients`), mirroring the asset-loan twin
  from `20260720130100`; the migration backfilled every already-closed parcel. The
  row survives as proof that a notification was sent — only the address goes.
- **`parcel-files-cleanup` reads the per-company window** through the same RPC
  (cached per company folder) instead of the single platform setting.
- Settings changes are audited (`retention.company_changed`, before/after), and
  every purge logs table, row count and window.
- **Both levels have a screen**, sharing one category catalogue and one field list
  (`web/src/components/retention-fields.tsx`): `CompanyRetentionFields` on
  `/configure/personal-data` (empty field = inherit, and the row says what it
  inherits) and `PlatformRetentionFields` on `/operia/retention` (DCA's defaults,
  with an explicit warning that a change reaches every customer without their own
  setting). Schedule and rationale:
  [`docs/gdpr/retention-schedule.md`](gdpr/retention-schedule.md).
- Platform-side audit was **incomplete until `20260814170000`**: the five new default
  columns were written by triggers that only knew the three old ones, so a platform
  admin could set a default that deletes customer data without leaving a trace. The
  two overlapping triggers are now one function covering all eight categories, still
  logging `retention.changed` but with before/after per changed field.
- Verified 2026-08-14 against the live database in a rolled-back transaction:
  386 closed demo parcels purged with **0 orphaned events**, audit rows purged, all
  logged.
- **Review hardening 2026-08-15** (`20260815090000_gdpr_review_fixes.sql`): the
  `parcel_documents` delete-log trigger from `20260814190000` fired on the cascade
  from a parcel delete too, inserting an event for a parcel already gone — an FK
  violation that aborted the *entire* nightly purge; it now logs only when the
  parcel still exists. The notifications purge deleted by age alone, wiping the
  dispatcher's dedup/counter state for still-**open** parcels (the reminder ladder
  would restart) — it now only touches notifications whose parcel is closed or
  gone (asset twin: returned or gone). And audit rows belonging to a **deleted**
  company (no FK by design) matched neither the platform branch nor the company
  loop and were retained forever — they now follow the platform window.
  `parcel-files-cleanup` no longer aborts wholesale when the `retention_days`
  lookup fails (orphan sweep must always run; a failed lookup means "no window"
  and is logged), its closed-status set finally includes `removed`, and document
  files whose `parcel_documents` row is gone while the parcel survives (an erasure
  where the file removal failed) are now swept as orphans after a one-day grace.

## 16. Subject access export — Art. 15 (G)

Added 2026-08-14, `20260814150000_sar_export.sql`. `sar_export(company, employee, query)`
gathers everything Operia holds about one person, server-side.

- **Two entry points, because personal data lives in two shapes**: a keyed lookup
  follows the foreign keys (employee row, parcels as receiver/collector, events on
  those parcels, events the person performed, notifications, asset loans, user
  account, audit rows as actor), and a **folded free-text search** finds people who
  have no row at all — proxy collectors and private senders exist only as a string
  in someone else's parcel (`delivered_to`, `sender`, `delivered_note`,
  `receiver_override_reason`, `removed_reason`, `condition_note`). Folding is
  `fold_name()`, the same Danish transliteration the AI matching layer uses
  (æ→ae, ø→oe, å→aa), so a search matches regardless of case or diacritics.
  Since `20260815090000` the match is **word-anchored** (`fold_contains()`):
  "Anne Jensen" no longer matches inside "Marianne Jensen", which would have
  handed one person's parcels to another in an Art. 15 dossier. The same fix
  added the free-text **documentation notes** (`parcel_documents.note`,
  `asset_documents.note` — the very fields the erasure path exists for) as their
  own export sections; before, a proxy collector named only in a note was
  invisible to the export.
- **Authorization is server-side** (`SECURITY DEFINER` bypasses RLS): platform admin,
  or manager/data_manager in exactly that company.
- **Sections are capped** at `sar_section_limit()` (500) and the response says
  `truncated: true` per section, so nobody mistakes a cap for completeness.
- **Files are listed, not exported** — bucket + path for photos and signatures, so
  handing over an image stays a deliberate act.
- **The export logs itself**: `privacy.sar_exported` with employee number and row
  counts, never the name or the content. A complete dossier about one person is
  itself an intrusive operation and must be reviewable.
- Art. 15(1) needs more than rows (purposes, recipients, retention, rights), so the
  response carries a `notice` block pointing at `docs/gdpr/`.
- UI: `web/src/components/company-sar-export.tsx` on `/configure/personal-data` —
  counts per section on screen, JSON download built in the browser.
- Verified 2026-08-14 against live demo data: keyed lookup returned 26 parcels /
  51 events / 4 notifications for one employee; free-text `Anita Trampedach`
  returned 7 parcels naming her without a foreign key.

## 17. Free text and provider errors (G)

The sweep behind [`docs/gdpr/free-text-fields.md`](gdpr/free-text-fields.md)
(2026-08-14) classified every text column in the schema. 13 need a scrub /
time-limit / evidence decision; two findings were plain gaps and were fixed
rather than decided (`20260814190000_parcel_documents_erasure.sql`):

- **`parcel_documents` had no erasure path.** Its asset twin got one in
  `20260801180000`, but the parcel side kept only `insert` and `select` policies —
  so a platform admin could delete the *photo* from `parcel-photos` while the
  free-text note beside it was unreachable for everyone. Now: platform-admin-only
  DELETE (deliberately not managers — documentation is evidence), UPDATE still
  revoked for all (erasure is deletion, never rewriting), deletion written to
  `parcel_events` as `document_deleted` and mirrored to `audit_log`, and a delete
  button on the documentation list in `parcel-condition.tsx` gated on
  `isPlatformAdmin`.
- **Provider error strings echoed recipients.** `parcel_notifications.error`,
  `asset_loan_notifications.error` and `log_drains.last_error` stored the raw
  vendor response, and a rejection quotes the address that failed
  (`550 5.1.1 <anna@firma.dk> unknown`) — a back door around the masking in §6 and
  the recipient clearing in §15. `sanitizeProviderError()`
  (`supabase/functions/_shared/notify.ts`) now masks e-mail addresses and 8+ digit
  numbers **at the point of storage**, applied at all 11 persistence sites across
  five edge functions; the response returned to the manager who typed the address
  is deliberately left intact. Status codes, short numbers, dates and clock times
  stay readable — since 2026-08-15 the phone rule no longer spans hyphens, so an
  ISO timestamp (`2026-08-14 03:22`) survives; a *contiguous* run of 8+ digits is
  still masked even when it is a vendor message id, because a number that slips
  into an immutable log can never be removed again. The migration nulled
  pre-existing rows matching either pattern (deliberately over-broad: an old
  error string has no operational value, and some contained only a timestamp).

- **Deleting evidence was classified `success`** until `20260814200000`:
  `audit_level()`'s `like '%.deleted'` needs a literal dot before "deleted", and both
  `parcel.document_deleted` and `asset.document_deleted` end in `_deleted` (the dot sits
  after `parcel`/`asset`). The function already carried escaped twins for `_failed`,
  `_bounced`, `_overridden` and `_complained` — `_deleted` was the one that was missed,
  so since 2026-08-01 an erasure of chain-of-custody documentation did not surface in the
  warning-level filter the weekly log review depends on. Now `warning`; stored levels
  recomputed (append-only content untouched, only the generated column).

## Known gaps / roadmap

| Gap | Status |
|---|---|
| MFA + Entra ID SSO (NIS2 requirement per spec §security) | **Partly** (row corrected 2026-08-14 — it claimed TOTP was disabled) — `[auth.mfa.totp]` has `enroll_enabled = true` / `verify_enabled = true` in `config.toml`; phone MFA and WebAuthn MFA stay off. Still **open**: no enrolment UI anywhere in the web app, so no user can actually add a factor, the hosted project's MFA state must be confirmed in the Dashboard, and there is no Entra ID SSO. |
| Retention settings UI | **Fixed 2026-08-14** (§15) — eight categories on both levels: the customer's own on `/configure/personal-data`, DCA's defaults on `/operia/retention`. Everything still defaults to NULL = keep until further notice, so nothing is deleted until someone sets a window. |
| Web passkey activation | **Open** — `[auth.passkey]` / `[auth.webauthn]` are set in `config.toml`, but CLI 2.111.0's `config push` silently ignores them (verified 2026-08-04: an invalid value still reports "up to date"), so the hosted project still reports `passkeys_enabled: false`. A platform admin must switch it on in Dashboard → Authentication → Passkeys with the same rp values. Until then `login_biometric_enabled` stays false (default since `20260804051827`) and the web button is hidden; the handheld is unaffected. |
| Handheld session at rest | **Open** — supabase-kt persists the session in plain SharedPreferences. Biometric login gates the *app* at startup, not the stored token, so a rooted/ADB-accessible device can still read it. A Keystore-backed `SessionManager` would be the fix. |
| Hosted password policy | **Open** — `config.toml` raised to 8 (2026-07-16) but the hosted project's Auth → Passwords setting must be raised manually in the dashboard. |
| `?token=` removal from hook URLs | **Pending verification** — header/basic-auth deployed and verified 2026-07-16; drop the query fallback from `gateway/docker-compose.yml` and the Postmark URL after the next gateway redeploy. |
| `gateway/.env` file permissions | **Fixed on the current box** (600, 2026-07-16) + README instruction; re-check on any new deployment. |
| `parcel-photos` / `signatures` lifecycle | **Fixed 2026-07-20** (§6) — DELETE policies + daily orphan/retention purge. Retention window still defaults to NULL (keep forever) and has no UI. |
| `imports-cleanup` edge function | **Done** — implemented; 30-day purge of the `imports` bucket. |
| Anonymization of free text | **Inventoried 2026-08-14, decisions pending** ([`docs/gdpr/free-text-fields.md`](gdpr/free-text-fields.md) lists all 13 fields with a recommendation each; §17 covers the two that were fixed instead) —  `parcels.delivered_to` / `delivered_note` / `receiver_override_reason` / `removed_reason` (the last two added 2026-07-30) hold the free-text name of whoever collected a parcel (often a proxy, i.e. a third party) and are not cleared by any anonymization path. The signature image is now purgeable but the name beside it is not. Decide: scrub on anonymize, or document the retention as chain-of-custody evidence. |
| Personal data in `audit_log` | **Partly by design since 2026-07-30** — `parcel.receiver_overridden` and `parcel.removed` now copy the manager's free-text reason into `detail` (`20260730140000_audit_parcel_reason.sql`), because the reason *is* the audit trail for an exception; it may name a person. Every other event type stays minimized. |
| Personal data already in `audit_log` | **Open** — new writes are otherwise minimized (§6), but rows written before 2026-07-20 still contain employee names, `EX-<name>` retirement entries, invitee emails and unmasked recipients. The table is UPDATE/DELETE-blocked, so only the global age-based purge can remove them — and `audit_retention_days` defaults to NULL. Copies already delivered to log drains are beyond reach. |
| Notification recipient logs | **Fixed 2026-08-14** (§15) — `parcel_notifications.recipient` is cleared when the parcel closes, mirroring the asset-loan twin, and the backfill cleared every already-closed parcel. Both tables now fall under the `notifications` retention category. |
| Right of access (Art. 15) | **Largely fixed 2026-08-14** (§16) — `sar_export()` + the screen on `/configure/personal-data` answer a request for employees *and*, via folded free-text search, for people with no row (proxy collectors, private senders). Remaining: image files are listed rather than packaged, sections cap at 500 rows, and there is no PDF rendering — the export is JSON. |
| Consent / legal basis / opt-out | **Open** — no consent column, no legal-basis record, no per-employee notification preference or opt-out. Notification toggles exist only at platform and company level; the data subject has no control. |
| Per-company retention | **Fixed 2026-08-14** (§15) — `company_retention` gives the controller its own window per category, resolved customer → platform → keep forever. `parcel_events` remains deliberately without one (it follows the parcel). Remaining: agree actual values with each customer; see [`docs/gdpr/retention-schedule.md`](gdpr/retention-schedule.md). |
| Processor agreements / transfers | **Partly (2026-08-14)** — the register now exists: [`docs/gdpr/subprocessors.md`](gdpr/subprocessors.md) lists every recipient (Supabase/AWS, Resend, Postmark, GatewayAPI, Mistral, Anthropic, Google AI + Maps, OpenRouteService, customer log drains), what each receives, where it is processed and on what transfer basis, with a dated verification log. Verified from vendor primary sources: **Resend, Postmark (ActiveCampaign) and Google LLC are DPF-certified; Supabase and Anthropic are not — they rely on SCCs.** Still **open**: confirm each on the official `dataprivacyframework.gov` list, execute/file the vendor DPAs, write one TIA per US vendor, confirm the AWS region of DCA's own gateway/web box, and move the AI keys off free tiers. The DPA annexes are **drafted** (`docs/gdpr/dpa/bilag-da.md`, version `DCA-DPA-1.0`, Datatilsynet's standard clauses as the body) but not yet legally reviewed or signed by anyone; §14 adds the in-product contacts and signature record the annexes depend on. |
| Free AI tiers train on the data | **Documented, decision pending (2026-08-14)** — Gemini (`20260806193000_ai_gemini_lite_models.sql`) *and* Mistral's free "Experiment" plan both permit the vendor to use requests for model improvement. Both providers are now flagged `hasFreeTier` in `web/src/lib/ai.ts` and carry a warning on Operia → Integrationer, and the rule ("free tier = development with synthetic labels only; production requires a paid plan with a DPA") is written into [`subprocessors.md`](gdpr/subprocessors.md) §2. **Open**: actually moving the production key to a paid plan — intended provider is Mistral (EU, DPA, zero data retention). Anthropic has no free tier. |
| Real personal data in git history | **Partly (2026-08-14)** — `docs/labels/` is untracked and gitignored, so no label images are in the working tree of any future commit. The 13 images committed 2026-08-06 → 2026-08-13 **remain reachable in git history**; the current set is synthetic test labels, so this is documented as an accepted residual rather than rewritten. If a real label ever entered the repo, history rewrite (`git filter-repo`) + force-push is required, and any clone/fork must be re-cloned. |

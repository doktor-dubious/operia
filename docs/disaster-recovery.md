# Disaster Recovery — Operia

**Purpose:** how to recreate the entire Operia backend from scratch — on a fresh Supabase
cloud project, or fully locally — if the Supabase project `rjlxmdfmktucunxehtqz` is lost,
suspended, or you need a clean environment.

**Core principle:** the database is *not* the source of truth — **git is**. All schema lives in
ordered migration files. Recreating structure is fully automated. What git does **not** hold is
listed under [Gaps](#gaps-not-in-git) — those are the real recovery risks.

---

## TL;DR

```bash
# Fresh cloud project
supabase link --project-ref <NEW_REF>
supabase db push                 # replays all migrations (schema, keys, RLS, functions, cron)
psql "$DB_URL" < supabase/seed.sql
supabase functions deploy        # all edge functions
supabase secrets set --env-file supabase/.env.secrets   # see secrets checklist below
# then: create Vault secret, re-upload storage, re-enter free-tier auth config

# Fully local (Docker) — for offline dev
supabase start                   # applies all migrations + seed.sql automatically
```

---

## What git fully recovers (no manual work)

| Asset | Location | Recreates |
|---|---|---|
| Schema — tables, keys, indexes, RLS, functions, triggers, enums | `supabase/migrations/*.sql` (141 files, ordered) | The entire database structure |
| Storage bucket **definitions** | migrations (`insert into storage.buckets`) | Buckets: `app-dist`, `company-logos`, `feedback`, `imports`, `parcel-photos`, `signatures` |
| pg_cron **schedules** | migrations (`cron.schedule(...)`) | 7 jobs: asset-reminders, entra-sync, imports-cleanup, log-drain-dispatch, parcel-files-cleanup, parcel-notifications, retention-purge |
| Seed / reference data | `supabase/seed.sql` | Baseline rows |
| Edge Functions (23) | `supabase/functions/` | All server-side logic |
| Project config | `supabase/config.toml` | Auth, rate limits, storage, MFA settings |

---

## Gaps — NOT in git

These must be re-established by hand. **This section is the actual disaster-recovery work.**

### 1. Edge Function secrets (highest risk — back these up in a password manager)

Set via `supabase secrets set` on the project. Custom secrets referenced by the functions:

| Secret | Used by |
|---|---|
| `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_WEBHOOK_SECRET` | invite/reset emails, resend-webhook |
| `GATEWAYAPI_TOKEN`, `GATEWAYAPI_SENDER` | SMS dispatch |
| `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_TENANT_ID` | entra-sync / entra-config |
| `GOOGLE_MAPS_API_KEY`, `ORS_API_KEY` | route-calc / maps-key-status |
| `APP_URL` | links in emails |

> `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are **auto-injected** into
> edge functions by the platform — do **not** set them manually.

### 2. Vault secret for pg_cron (silent failure if missing)

The scheduled jobs call edge functions using the service-role key stored in **Postgres Vault**,
not in any migration. Until this secret exists, all cron-driven features stay dormant (by design —
no errors, just nothing happens):

```sql
select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
```

Run once against the new database, using the new project's service_role key.

### 3. Storage bucket *contents*

Bucket definitions are in git; the **files are not**. Lost on recreate unless separately backed up:
- `parcel-photos` — intake condition photos
- `signatures` — handover signatures
- `company-logos` — tenant branding
- `app-dist` — handheld APK builds (rebuildable from `android/`)
- `imports` — uploaded CSVs (transient)
- `feedback` — feedback attachments

For anything that matters, take periodic storage backups (Supabase CLI / S3 sync).

### 4. Actual data & auth users

Migrations rebuild *structure*, not production rows. Real parcels, companies, employees, and
`auth.users` accounts require `pg_dump` / Supabase PITR backups (paid tier) to restore.

### 5. Free-tier config that can't be pushed

On the free tier `supabase config push` cannot push email templates / some auth config (and the
GoTrue password-verification **auth hook** that powers the login audit). Re-enter these by hand in
Dashboard → Authentication after recreate. See `docs/` notes on auth hooks.

### 6. Local `.env` files (gitignored — back these up)

| File | Holds |
|---|---|
| root `.env` | `SUPABASE_DB_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `ENTRA_*` |
| `web/.env` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| `docs/operia.txt` | passwords (never committed) |

---

## Full recreate — fresh Supabase cloud project

1. **Create** a new project in the Supabase dashboard; note its ref, DB password, and keys.
2. **Link:** `supabase link --project-ref <NEW_REF>` (enter DB password when prompted).
3. **Schema:** `supabase db push` — replays all 141 migrations, creating tables, keys, RLS,
   functions, triggers, storage buckets, and cron schedules.
4. **Seed:** `psql "<DB_URL>" < supabase/seed.sql` (or `supabase db push --include-seed`).
5. **Vault:** run the `vault.create_secret('<NEW_SERVICE_ROLE_KEY>', 'service_role_key')` SQL
   (§2 above) so pg_cron jobs can authenticate.
6. **Functions:** `supabase functions deploy` (all) — then `supabase secrets set ...` for every
   secret in §1.
7. **Config:** `supabase config push` for what the tier allows; re-enter the rest (§5) by hand.
8. **App wiring:** update root `.env` and `web/.env` with the new project's URL + keys; redeploy
   web (`web/deploy.sh`) and re-point the handheld build.
9. **Storage:** restore bucket contents from backup if applicable (§3).
10. **Data:** restore rows from `pg_dump` / PITR if this is a real recovery (§4).

## Full recreate — local Docker stack (offline dev)

```bash
supabase start     # reads supabase/migrations/ + supabase/seed.sql, brings up the full stack
supabase status    # shows local URL, anon key, service_role key, Studio URL
```

- Applies **all migrations + seed automatically**; no cloud project needed.
- For cron + edge-function features locally, set the Vault secret (§2) and run
  `supabase functions serve` with a local `.env` of the §1 secrets.
- Reset to a clean slate anytime: `supabase db reset` (re-runs every migration + seed).

---

## Verify a recreate worked

```bash
supabase migration list                       # local vs remote applied migrations match
psql "<DB_URL>" -c "\dt"                       # tables exist
psql "<DB_URL>" -c "select cron.job_id, jobname from cron.job;"   # 7 cron jobs present
psql "<DB_URL>" -c "select id from storage.buckets order by id;"  # 6 buckets present
psql "<DB_URL>" -c "select 1 from vault.decrypted_secrets where name='service_role_key';"
```

---

## Backup checklist (do these *now*, before you ever need this doc)

- [ ] Export all edge-function secrets (§1) + Vault key + `.env` files (§6) to a password manager.
- [ ] Enable Supabase automated backups / PITR (paid tier) for real data resilience.
- [ ] Schedule periodic storage-bucket backups for `parcel-photos` and `signatures`.
- [ ] Keep this repo pushed to a remote git host (schema + functions live only in git).

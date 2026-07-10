# CLAUDE.md — Operia (interim)

> **Status: interim.** Written 2026-07-09 from the prototype code and the draft spec at
> `docs/DCA Logic - draft.docx` (v1.0, Trampedach/Gabrielsen). The spec is explicitly tentative;
> development will be agile. Update this file as the real project structure lands.

## Repo layout (scaffolded 2026-07-10)

The project was renamed **Operia** and this directory is now the real repo. See `README.md` for
setup commands. The sections below about "the prototype" refer to `prototype/connection_software/`,
which is **reference only** — nothing in it deploys.

- `web/` — admin SPA: Vite + React + TS, Tailwind v4 + shadcn/ui, TanStack Router (file-based
  routes in `src/routes/`) + Query, i18next (Danish default, English fallback). Animated icons
  installed per-icon via shadcn CLI from the animate-ui and lucide-animated registries (patterns
  in README.md). `npm run gen:types` regenerates `src/lib/database.types.ts`.
- `android/` — handheld app: Kotlin + Jetpack Compose + supabase-kt, version catalog in
  `gradle/libs.versions.toml`. Opens in Android Studio; Gradle wrapper not committed yet.
- `supabase/` — CLI project, **linked to the real Supabase project `rjlxmdfmktucunxehtqz`**
  (name "Operia", eu-north-1). All schema as ordered files in `supabase/migrations/` (empty so
  far — next step is rewriting the prototype SQL cleanly; see the hazards section below for what
  NOT to carry over).
- Secrets: root `.env` (`SUPABASE_DB_PASSWORD`), `web/.env`, and `docs/operia.txt` are gitignored.
  The service_role key must never enter the repo.

## What this project is

**Intra** (working names: Intra / Operia) is a multi-tenant SaaS **track & trace system for
internal parcel handling**, built by **DCA Logic**. It replaces manual logbooks with a single
auditable record from the moment a parcel arrives at a company until it is collected, rejected,
returned, or otherwise resolved.

First leg of the project:
- An **administration module** (web) — prototyped in this directory.
- An **Android handheld app** ("Operia") for parcel handlers — prototyped separately (not in this repo).

The prototype grew beyond parcels into a small product suite sharing one backend: parcel
track & trace, asset/inventory management, smart lockers, IoT sensors, shipping, route planning,
and room booking. The parcel system is the core deliverable.

## Domain vocabulary (from the spec)

| Term | Meaning |
|---|---|
| Parcel Handler | Employee receiving/moving parcels (reception or receiving area) |
| Final Receiver | Employee the parcel is addressed to |
| Manager | Per-company admin: config, users, exception resolution |
| Parcel | Any shipment: package, pallet, letter |
| Platform admin | DCA Logic staff — super-tenant above all customers |

Roles are RBAC (`user_roles.role`: `manager`, `parcel_handler`, `final_receiver`); all imported
employees are receivers by default with no system access. Everything auditable is logged with
user id + timestamp; audit logs must be immutable.

## Core flows (spec §5–§10)

- **Flow 0 — Employee directory import**: CSV via email or SFTP fetch, UTF-8 (æ/ø/å), validated;
  malformed imports rejected with Manager alert. *(Not yet in the prototype.)*
- **Flow 1 — Intake**: handheld barcode scan → receiver autocomplete (initials/name/department,
  department auto-populates), optional sender/type/private-vs-corporate/storage location,
  condition capture (preset + note + photo) → save → notify receiver (SMS/email, quiet hours,
  fallback rules, multi-language templates — Danish first). Unmatched receiver ⇒ *unassigned* state.
  Unresolved in spec: unscannable barcodes, duplicate scans, batch intake.
- **Handover**: accept/reject with on-screen signature or NFC/MIFARE card; proxy collection and
  "left at location" subject to the parcel's handling classification; rejections flagged.
- **Flow 2 — Relocation**: every internal move is scanned; storage locations with barcode
  (scan) or without (pick from list); full history per event (who/when/from/to/status).
- **Dashboard**: operational counts, per-department overview, classification breakdowns,
  exception management (unassigned, overdue, rejected), recent activity, full chain-of-custody search.
- **Security**: username/password baseline, Entra ID SSO where feasible, MFA per customer (NIS2),
  GDPR on personal data, immutable audit logs.

## What's in this directory (prototype)

```
connection_software/
├── Operia_DCA/            # Single-file HTML apps (no build step), Danish UI
│   ├── index.html                → redirects to dca-launcher.html
│   ├── dca-launcher.html         → login + per-company product tile launcher
│   ├── intra-app.html            → main parcel app (receive/handout/edit/route/ship/stats)
│   ├── intra-admin-portal.html   → management console (company managers + DCA platform admins)
│   ├── intra-assets.html         → asset & inventory management
│   ├── intra-web-intake.html     → kiosk-style parcel intake (barcode scan + photo)
│   ├── intra-accept.html         → invite/password-reset landing page
│   └── dca-booking-supabase.html → room booking + invoicing (separate product line)
├── *.ts                   # Supabase Edge Functions (Deno), e.g.:
│   ├── index.ts                  → "send-arrival": arrival email via Resend, templated
│   ├── create-tenant.ts / delete-tenant.ts / admin-reset-password.ts  → platform-admin provisioning
│   ├── send-reminders.ts         → cron: remind on uncollected parcels (x-cron-secret)
│   ├── expire-locker-handouts.ts → cron: release expired locker handouts + email
│   ├── send-locker-code.ts       → PIN/QR pickup codes
│   ├── iot-uplink.ts             → LoRaWAN webhook (Milesight/ChirpStack/TTN) → iot_readings
│   └── ship-create.ts            → shipping orchestration (carrier calls STUBBED)
├── SQL/ + root *.sql      # Schema migrations & scripts (order matters, see warnings)
└── intra-backup.zip       # backup archive
```

### Running the admin prototype

Static files — no build. Serve `Operia_DCA/` with any web server, e.g.:

```bash
cd Operia_DCA && python3 -m http.server 8737
# open http://127.0.0.1:8737/  (redirects to dca-launcher.html)
```

Requires internet: pages load supabase-js/Chart.js/GridStack/PapaParse/jsbarcode from CDN and talk
to the **live shared Supabase project `xklwtwgsxslwhssdcbdf.supabase.co`** (URL + anon key are
hardcoded in every file). A login on that instance is needed to get past the auth screen.
Invite/reset flows require the page origin whitelisted in Supabase Auth → Redirect URLs.
Comments say deploy target is Netlify ("Skift til Netlify-URL ved deploy").

## Prototype architecture

- **Single shared Supabase project** hosts everything: Postgres + RLS, Auth (email/password),
  Storage buckets (`parcel-photos`, `signatures`, `labels`, `branding`), Edge Functions,
  pg_cron/pg_net.
- **Multi-tenancy**: tenant boundary is `company_id`. Helper `SECURITY DEFINER` functions:
  `current_company_id()`, `is_platform_admin()`, `has_feature(key)`, `has_product(key)`.
  Standard RLS pattern: `company_id = current_company_id() OR is_platform_admin()`.
- **Two-level entitlements**: `product_catalog`/`company_products` (whole systems: intra, booking,
  assets, lager, route, shipping) and `feature_catalog`/`company_features` (add-ons: reminders,
  signature, photo, label_print, smart_lockers, iot, warehouse, `hh_*` handheld features…),
  both with `valid_until` expiry. UI nav/screens are gated per company.
- **Trust model**: the browser UI is untrusted. Edge Functions use the service-role key and
  re-verify authorization server-side; enforcement is RLS + server checks, never client flags.
- **Key tables**: `companies`, `app_users`, `user_roles`, `platform_admins`, `employees`,
  `departments`, `parcels` (+ `parcel_events` audit trigger, status state-machine trigger:
  unassigned→registered→in_storage/in_transit/in_locker→delivered/rejected/returned),
  `carriers`, `handling_classes`, `reminder_settings`, `lockers`/`locker_jobs`, `assets`/
  `inventory_items`/`movements`, `iot_devices`/`iot_readings`, `shipments`/
  `company_ship_settings`/`company_carrier_credentials`, `saved_routes`, `company_branding`/
  `app_layouts`/`app_labels` (white-labeling), `rooms`/`bookings`/`accounting_config` (booking),
  `notification_templates`, `integration_config`.
- **Integrations** (varying maturity): **Resend** (all email), **Keynius** smart lockers
  (physical open is a commented-out stub), **Milesight/LoRaWAN** IoT ("Forberedt — funktion på
  vej"), **Shipmondo/nShift/GLS/PostNord** shipping (stubbed pending carrier agreements),
  **Brother TD-4550DNWB** label printing, **e-conomic/Dinero/Billy** accounting, **Dalux** FM,
  Google Maps (route planning), api.qrserver.com (QR images).

## Known gaps & warnings (verify before relying on this code)

- **Secret committed to repo**: a live `CRON_SECRET` value sits in `SQL/intra-reminders-cron.sql`.
  A platform-admin auth UID and the Coor test-tenant UUID (`11111111-…`) are also hardcoded/seeded.
  Rotate/parameterize before anything real.
- **Duplicate migration**: `SQL/intra-parcel-events.sql` and `SQL/intra-parcel-events .sql`
  (trailing space) are near-duplicates; the spaced one DROPs and recreates `parcel_events` —
  running them in the wrong order wipes event history.
- **Locker expiry exists in two versions** (int-returning cron version vs table-returning version
  used by the edge function) — `expire_locker_handouts()` definitions differ across files.
- **Stubs**: Keynius physical locker opening, carrier booking in `ship-create.ts`, public
  self-service booking (disabled in shared multi-tenant setup), IoT features flagged "on the way".
- `parcels.condition_photo_path` may be missing on older schema versions (intake page tolerates it).
- Prototype-only shortcuts: hardcoded anon key in every HTML file, single shared Supabase project
  for all tenants, hand-rolled test PDF labels.

## Spec requirements NOT yet in the prototype

- Employee directory import (email file / SFTP, validation, Manager alerts) — Flow 0.
- SMS notifications (email only today), quiet hours, notification fallback rules.
- NFC/MIFARE identity capture (signature capture exists).
- Entra ID SSO and MFA.
- Immutable audit-log guarantees (parcel_events exists but immutability isn't enforced).
- Duplicate-scan handling, batch intake, unscannable-barcode flow (unresolved in spec too).

## Conventions observed

- UI language is **Danish** (multi-language templates planned, English second); code comments
  largely Danish.
- Single-file HTML apps with hash-based views (`data-view`), feature-flag-driven nav.
- Edge functions: Deno, `Deno.serve`, supabase-js v2 from esm.sh; JWT-verified unless cron/webhook
  (`x-cron-secret` / `x-webhook-secret`).
- Dates/IDs: shipment refs `SHIP-YYYY-NNNNNN` via sequence+trigger; storage paths
  `<company_id>/<parcel_id>.png`.

# CLAUDE.md — Operia

**Operia** is a multi-tenant SaaS **track & trace system for internal parcel handling**, built by
**DCA Logic**. It replaces manual logbooks with a single auditable record from the moment a parcel
arrives at a company until it is collected, rejected, returned, or otherwise resolved.

This repo is the **real, greenfield project**. It consists of:
- `web/` — admin web app (managers + DCA platform admins)
- `android/` — handheld app for parcel handlers (barcode scan, camera, NFC)
- `supabase/` — database migrations + Edge Functions (linked project below)

Spec: `docs/DCA Logic - draft.docx` (v1.0, Trampedach/Gabrielsen — tentative, development is agile).

## The prototype is scope reference ONLY

`prototype/` (gitignored, local only) holds an old prototype built on a *different* Supabase
instance we never got working access to. It defines the **functional scope** to recreate —
**none of its code, SQL, or visual design is reused, and no data migrates**. Don't copy from it;
read it only to answer "what should this feature do".
It also contains a live `CRON_SECRET` in its SQL — one more reason it stays out of git.

Functional scope covered by the prototype (parcels are the core deliverable; the rest are
feature-gated add-on products): parcel intake/handover/relocation/history, dashboard + exception
management, employee/department directory, asset & inventory management, smart lockers, IoT
sensors, shipping, route planning, room booking, white-labeling (branding/labels/layouts),
notification templates, reminders.

## Tech stack (settled — don't re-litigate)

- **Backend**: Supabase project **Operia**, ref `rjlxmdfmktucunxehtqz`, `eu-north-1`, Postgres 17.
  Postgres + RLS, Auth (email/password now; Entra ID SSO + MFA later, NIS2), Storage,
  Edge Functions (Deno), pg_cron. All schema changes are **ordered migration files in git**
  (`supabase migration new` → `supabase db push`) — never dashboard clicks.
- **Web**: Vite + React + TypeScript SPA (deliberately not Next.js), Tailwind v4 + shadcn/ui,
  TanStack Router (file-based routes in `web/src/routes/`) + TanStack Query, i18next.
  Generated DB types (`npm run gen:types` → `web/src/lib/database.types.ts`) are the contract.
  Animated icons via shadcn registries — see README.md for the two install patterns
  (animate-ui, lucide-animated).
- **Android**: Kotlin + Jetpack Compose + supabase-kt (deliberately not React Native).
  Opens in Android Studio; no Java/Gradle on this dev machine.

## Design direction (agreed 2026-07-10, revised same day)

- **Colors, typography and (classic) sidemenu metrics come from Supabase Studio's theme**
  (hue 159 OKLCH engine, resolved to static tokens in `web/src/index.css`; dark background
  `#131413`, highlighted text `oklch(.95 .00275 159)`, non-highlighted `oklch(.684 .00275 159)`).
  Font: **Inter**, 13px base, weight 500 on menu items/buttons. Radius scale 4/6/8px.
  Sidebar: 240px, compact muted items that highlight on hover, uppercase section labels.
  Header: page title left; top-right area with small borderless ghost icon buttons
  (Feedback, Search so far) + user menu. Toasts: **shadcn Sonner**, top-right.
- **From `/home/rune/workspace/projects/compliance-circle`** (secondary ref
  `/home/rune/workspace/projects/gorm.ai`): the bottom-left dropdown pattern (**few icons,
  icons on the RIGHT via DropdownMenuShortcut**, animate-ui icons with `animateOnHover`),
  the default button (colors + hover effect radius 3px→8px, styled via
  `button[data-variant="default"]` in index.css), and the status palette for parcel badges.
- **Two navigation modes, user-configurable** (`classic` | `modern`):
  - *Classic*: always-visible sidebar with all functionality, Supabase Studio styling.
  - *Modern*: navigation collapsed into the bottom-left dropdown.
- **Theme**: defaults to **system**, user override to light/dark. Both themes fully defined.
- **User dropdown**: must NOT contain "Feature preview" or "Timezone" items (explicitly excluded).
- **UI language is Danish first**, English fallback. Per-tenant text overrides (`app_labels`
  concept) layer **on top of** i18n resources at lookup time — never edited into locale files.

## Architecture principles

- **Tenant boundary is `company_id`** on every tenant-owned table. RLS pattern:
  `company_id = current_company_id() OR is_platform_admin()` via `SECURITY DEFINER` helpers.
  Platform admins (DCA staff) are a super-tenant above all customers.
- **The browser/app is untrusted.** Enforcement lives in RLS + Edge Functions (service-role key
  re-verifies authorization server-side) — never client flags. The **service_role key must never
  enter the repo or chat**; the anon key is public by design.
- **Two-level entitlements**: products (whole systems: parcels, assets, lockers, booking, …) and
  features (add-ons per product), both per-company with expiry. UI nav and screens are gated on
  them.
- **Roles** (`user_roles.role`): `manager`, `parcel_handler`, `final_receiver`. Imported employees
  are receivers by default with no system access.
- **Audit**: everything auditable is logged with user id + timestamp. `parcel_events` is
  append-only and immutable (UPDATE/DELETE revoked and trigger-blocked) — this is the NIS2/GDPR
  audit story.
- **Parcel status state machine**:
  unassigned → registered → in_storage/in_transit/in_locker → delivered/rejected/returned.

## Domain vocabulary (from the spec)

| Term | Meaning |
|---|---|
| Parcel Handler | Employee receiving/moving parcels (reception or receiving area) |
| Final Receiver | Employee the parcel is addressed to |
| Manager | Per-company admin: config, users, exception resolution |
| Parcel | Any shipment: package, pallet, letter |
| Platform admin | DCA Logic staff — super-tenant above all customers |

## Core flows (spec §5–§10)

- **Flow 0 — Employee directory import**: CSV via email or SFTP fetch, UTF-8 (æ/ø/å), validated;
  malformed imports rejected with Manager alert.
- **Flow 1 — Intake**: barcode scan → receiver autocomplete (initials/name/department) → optional
  sender/type/private-vs-corporate/storage location, condition capture (preset + note + photo) →
  save → notify receiver (SMS/email, quiet hours, fallback rules, multi-language — Danish first).
  Unmatched receiver ⇒ *unassigned*. Unresolved in spec: unscannable barcodes, duplicate scans,
  batch intake.
- **Handover**: accept/reject with on-screen signature or NFC/MIFARE card; proxy collection and
  "left at location" per the parcel's handling classification; rejections flagged.
- **Flow 2 — Relocation**: every internal move is scanned; storage locations with/without
  barcode; full history per event (who/when/from/to/status).
- **Dashboard**: operational counts, per-department overview, classification breakdowns,
  exception management (unassigned, overdue, rejected), recent activity, chain-of-custody search.
- **Security**: username/password baseline, Entra ID SSO where feasible, MFA per customer (NIS2),
  GDPR on personal data, immutable audit logs.

## Commands

```bash
# Web
cd web && npm run dev          # needs web/.env (see web/.env.example)
cd web && npm run build
cd web && npm run gen:types    # regenerate database.types.ts from linked project

# Supabase (linked to rjlxmdfmktucunxehtqz; SUPABASE_DB_PASSWORD in gitignored root .env)
supabase migration new <name>
supabase db push
supabase start                 # local stack via Docker
```

## Secrets

Root `.env` (`SUPABASE_DB_PASSWORD`), `web/.env`, and `docs/operia.txt` are gitignored — never
commit or read `docs/operia.txt` (contains passwords). Never print the service_role key.

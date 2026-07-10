# Operia

Multi-tenant SaaS track & trace til intern pakkehåndtering, bygget af **DCA Logic**.
Erstatter manuelle logbøger med ét auditerbart forløb fra pakken ankommer til den er
afhentet, afvist eller returneret.

Spec: `docs/DCA Logic - draft.docx` · Prototype (kun reference): `prototype/` ·
Arkitektur og domæne: `CLAUDE.md`

## Struktur

```
operia/
├── web/          # Admin-webapp — Vite + React + TypeScript SPA
├── android/      # Håndterminal-app — Kotlin + Jetpack Compose (åbnes i Android Studio)
├── supabase/     # Migrationer (supabase/migrations/) + Edge Functions (supabase/functions/)
├── docs/         # Spec m.m.
└── prototype/    # Gammel prototype — reference, deployes ikke
```

## Backend (Supabase)

Projekt **Operia**, ref `rjlxmdfmktucunxehtqz`, region `eu-north-1` (Stockholm).
Postgres + RLS (tenant-grænse: `company_id`), Auth (email/password nu; Entra ID SSO + MFA senere),
Storage, Edge Functions (Deno), pg_cron.

```bash
supabase login                                   # én gang pr. maskine
supabase link --project-ref rjlxmdfmktucunxehtqz # DB-password: SUPABASE_DB_PASSWORD i .env (ikke i git)
supabase migration new <navn>                    # al skemaændring som migrationsfiler — aldrig dashboard
supabase db push                                 # kør migrationer mod linked projekt
supabase start                                   # lokal stack (Docker) til udvikling
supabase db reset --local                        # genkør migrationer + seed lokalt
```

Migrationerne dækker: tenancy-kernen (companies/app_users/user_roles/platform_admins + RLS-
helpers), entitlements (produkt-/featurekataloger med udløb), medarbejderkartotek
(departments/employees) og pakker (storage_locations, handling_classes, parcels med status-
state-machine samt append-only, immutabel `parcel_events`-hændelseslog).

**Lokal udvikling**: `supabase/seed.sql` (køres kun af `db reset`, aldrig af `db push`) opretter
demo-virksomheden "DCA Demo A/S" med login **demo@operia.local / operia123**. `web/.env` peger
som udgangspunkt på den lokale stack — skift til det rigtige projekt (kommenteret i filen) når
migrationerne er pushet.

**Service role-nøglen må aldrig i repo eller chat.** Anon-nøglen er offentlig by design
(RLS beskytter data).

## Web (admin)

Vite + React + TypeScript, Tailwind v4 + shadcn/ui, TanStack Router (filbaserede routes i
`src/routes/`) + TanStack Query, i18next (dansk først, engelsk fallback).

Design: farveskema og dropdown-stil er portet fra compliance-circle (se CLAUDE.md).
**To navigationstilstande** vælges under Indstillinger: *klassisk* (fast sidemenu) eller
*moderne* (menu i dropdown nederst til venstre — få ikoner, ikoner til højre). **Tema** følger
systemet som standard og kan overstyres til lys/mørk.

```bash
cd web
npm install
npm run dev        # kræver web/.env — se web/.env.example
npm run build
npm run gen:types  # genererer src/lib/database.types.ts fra linked Supabase-projekt
```

Animerede ikoner installeres som komponenter via shadcn CLI:

```bash
# animate-ui (https://animate-ui.com/docs/icons) → src/components/animate-ui/icons/
npx shadcn@latest add @animate-ui/icons-<navn>       # fx icons-bell

# lucide-animated (https://lucide-animated.com) → src/components/ui/
npx shadcn@latest add https://lucide-animated.com/r/<navn>.json   # fx truck.json
```

## Android (håndterminal)

Kotlin + Jetpack Compose + supabase-kt. Se `android/README.md`.

## Konventioner

- UI-sprog er dansk; engelsk som nummer to. Per-tenant tekst-overrides (`app_labels`)
  lægges som et lag ovenpå i18n-filerne — aldrig ind i dem.
- Alt skema ligger som ordnede migrationsfiler i git; GitHub er source of truth.
- Hemmeligheder ligger i `.env`-filer (gitignored) — se `.gitignore`.

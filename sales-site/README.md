# Operia sales site — besparelsesberegner

Static sales material at **https://operia-info.predictioninstitute.com** (deliberately
separate from the Operia app). No build step — `index.html` is self-contained.
The original mock-up sketch lives in `docs/sales-material/` (reference only).

## What the page does

- Savings calculator across four modules (Pakkehåndtering, Aktivstyring,
  Ruteplanlægning, Booking) with per-module toggles.
- **Two color themes** (switch top-right): `blue` (generic navy/blue) and
  `operia` (product identity: hue-159 green, dark panel `#131413`).
- **Presets**: Lille / Mellem / Stor virksomhed.
- **Shareable links**: "Kopiér link" serializes all inputs + theme to the query
  string (`?t=operia&w=299&pkg=1_70_2_4_3_250&…`); opening such a link restores them.
- **Lead capture** ("Få beregningen på mail" + demo checkbox): POSTs to the
  `sales-lead` edge function, which clamps/recomputes everything server-side,
  stores the lead in `sales_leads` (platform-admin read only, purged after 12
  months) and emails the calculation via Resend. Optional edge secret
  `LEAD_NOTIFY_EMAIL` gets an internal notification per lead.

The calculation assumptions live in `var A = {…}` in `index.html` **and** in
`supabase/functions/sales-lead/index.ts` — change both together.
(225 effective workdays = 45 workweeks; loss factor 0.85 on lost parcels/assets.)

## Juridiske sider (`legal/`)

Faste URL'er, som integrationspartnere kan henvise til — e-conomic kræver alle tre
ved registrering af en app:

| Side | URL |
|---|---|
| Slutbrugervilkår (EULA) | `/legal/eula.html` |
| Privatlivspolitik | `/legal/privacy.html` |
| Databehandleraftale | `/legal/dpa.html` |

`eula.html` og `privacy.html` skrives i hånden. **`dpa.html` genereres** fra
`docs/gdpr/dpa/bilag-da.md`, så den offentlige aftale aldrig driver fra repoets tekst:

```bash
node sales-site/legal/build-dpa.mjs   # kør efter enhver ændring af bilag-da.md
```

Generatoren oversætter markdown uden afhængigheder og erstatter interne
dokumenthenvisninger (`../ropa.md` m.fl.) med læsbare navne — nye dokumenter
tilføjes i `DOC_NAMES`. Selve bestemmelserne (Datatilsynets standard) linkes
til; kun bilagene gengives.

Alle tre sider har gule pladsholdere (`class="fill"`) for DCA Logics
stamdata — juridisk navn, CVR, adresse, e-mail, værneting. **De skal udfyldes
før siderne bruges over for kunder.**

## Deploy

```bash
sudo bash sales-site/setup-vhost.sh   # one-time: vhost + certbot + first deploy
sales-site/deploy.sh                  # subsequent content deploys
supabase functions deploy sales-lead  # backend changes
```

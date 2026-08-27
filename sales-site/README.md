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

## Deploy

```bash
sudo bash sales-site/setup-vhost.sh   # one-time: vhost + certbot + first deploy
sales-site/deploy.sh                  # subsequent content deploys
supabase functions deploy sales-lead  # backend changes
```

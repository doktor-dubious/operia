# Operia — sub-processor register

**Controller:** each customer company. **Processor:** DCA Logic.
**Status:** living document — this is the register required by GDPR Art. 28(2) and (4), and
Annex B of every data processing agreement.
**Last reviewed:** 2026-08-14 · **Owner:** DCA Logic privacy owner (see [toms.md](toms.md) §10).

A sub-processor is any third party that processes personal data on DCA Logic's behalf in order
to deliver Operia. This register lists every one of them, what data it receives, where it is
processed, on what legal basis it may leave the EU/EEA, and **which product feature engages it** —
so a customer can prove that a feature they have not enabled means no transfer to that vendor.

> **How to read the "engaged by" column.** Vendors marked *always* are part of the platform.
> All others are engaged only when the named feature is switched on. Every optional vendor can
> be switched off without losing the parcel core.

---

## 1. Register

| # | Vendor (legal entity) | Service in Operia | Personal data received | Processing location | Transfer basis (EU→3rd country) | Engaged by |
|---|---|---|---|---|---|---|
| 1 | **Supabase, Inc.** (US) | Database, Auth, Storage, Edge Functions — the platform itself | All tenant data: employee master data, parcels, receivers/senders, photos, signatures, notification logs, audit log, auth credentials | **EU — AWS `eu-north-1` (Stockholm)**; support/administration may be accessed from the US | SCCs in Supabase's DPA (Supabase is **not** DPF-listed) | *always* |
| 2 | **Amazon Web Services** (AWS EMEA SARL / AWS, Inc.) | Underlying infrastructure for Supabase (`eu-north-1`) and for DCA's own gateway + web host (`ftp.predictioninstitute.com`, `operia.predictioninstitute.com`) | Same as row 1 while at rest/in transit on the infrastructure; the gateway additionally streams HR CSVs (see row 6) | EU (Supabase project); **DCA's own box: region to be confirmed — see §4 open items** | Sub-processor of Supabase under its DPA; AWS SCCs + DPF (AWS, Inc. is DPF-certified) | *always* |
| 3 | **Plus Five Five, Inc.** (trading as **Resend**, US) | Transactional email: invitations, password resets, parcel notification email | Recipient name + email address, parcel barcode/reference, company name | US | **EU-U.S. Data Privacy Framework** (certified) + SCCs in Resend's DPA | Email notifications, user invitations (*always* for account e-mails) |
| 4 | **ActiveCampaign, LLC** (trading as **Postmark**, US) | Inbound email receiver for HR file ingestion (Flow 0 email route) | Whatever the customer's HR system e-mails: employee CSV (name, employee no., e-mail, phone, department), sender address | US | **EU-U.S. Data Privacy Framework** (certified, effective 2023-07-11) + Postmark DPA | *Data Transfer → email ingest* only |
| 5 | **GatewayAPI A/S** (DK) | SMS delivery for parcel notifications and reminders | Recipient MSISDN, message text (may contain receiver name, parcel reference) | **EU (Denmark)** | None needed — EU/EEA | *SMS notifications* only |
| 6 | **Mistral AI SAS** (FR) | AI label reading (OCR of the parcel label photo) | The full label photo: receiver and sender name, address, phone, carrier data | **EU (France)** | None needed — EU/EEA | *AI label reading*, if the customer selects Mistral |
| 7 | **Anthropic PBC** (US) | AI label reading (vision model) | Same as row 6 | US | **SCCs** in Anthropic's commercial DPA (Anthropic's own privacy policy names adequacy + SCCs; DPF certification **not** asserted by the vendor — treat as SCC-based) | *AI label reading*, if the customer selects Anthropic |
| 8 | **Google LLC** (US) | (a) Gemini API for AI label reading; (b) Geocoding / Routes / Maps JavaScript API for route planning | (a) Same as row 6; (b) employee and delivery **addresses**, and the browser's IP when the Maps JS API loads | US (global endpoints) | **EU-U.S. Data Privacy Framework** (Google LLC certified) — for Cloud/business services Google additionally relies on **SCCs** in the Google Cloud DPA | (a) *AI label reading* with Google selected; (b) *route planning* with Google as maps provider |
| 9 | **HeiGIT gGmbH** (DE) — OpenRouteService | Geocoding + route calculation (default maps provider) | Employee and delivery addresses | **EU (Germany)** | None needed — EU/EEA | *Route planning* (default provider) |
| 10 | **Customer-configured log drain target** | Receives the customer's own audit events (HTTP/NDJSON, Datadog, Loki) | `audit_log` rows — minimized: actor id, employee numbers, masked recipients; never names or message content | Wherever the customer points it | **Not DCA's sub-processor** — the customer chooses the destination and instructs the transfer as controller | *Log drains*, per company |

### Listed but not engaged

`OpenAI, L.L.C.`, `xAI Corp.` and `DeepSeek` appear in the AI provider catalogue
(`web/src/lib/ai.ts`) but **no code path sends data to them** — no models are enabled and the
edge function rejects them. They enter this register the day a model is enabled, and each
addition is a new transfer decision.

### Not sub-processors

- **Microsoft (Entra ID / Graph API)** — when a customer enables AD employee sync, Operia
  *reads from the customer's own Microsoft tenant* using credentials the customer supplies.
  Microsoft is the customer's processor, not DCA's.
- **The customer's own SFTP/e-mail infrastructure** on the sending side of Flow 0.

---

## 2. Free tiers: development only

Two vendors offer free tiers whose terms permit the vendor to use submitted content for model
improvement — **Google** (Gemini free tier) and **Mistral** (the free "Experiment" plan).
Sending customer personal data under those terms is not defensible.

**Rule:** an AI vendor may only be made available to customers in production when DCA's API key
for it is on a **paid plan with a data processing agreement** (and, where offered, zero data
retention). Free-tier keys are for development and testing **with synthetic labels only**.

This is enforced by documentation and UI warning, not by the API: the provider is flagged
`hasFreeTier` in `web/src/lib/ai.ts` and Operia → Integrations shows the warning next to the
provider before a platform admin exposes it to customers. Anthropic has no free API tier
(the key requires credit from the first call), so the flag is false there.

Current state (2026-08-14): DCA's Google and Mistral keys are **free-tier development keys**.
Production intent is a **paid Mistral plan** (EU processing, DPA, zero data retention).

---

## 3. Change procedure (Art. 28(2))

Customers give **general written authorization** for sub-processors in the DPA.

1. Any new external service that receives personal data is added to this register **before**
   it goes live, in the same commit as the code that engages it.
2. Customers are notified in writing **at least 30 days** before the change takes effect,
   at the data protection contact the customer maintains in-product under
   **Konfigurér → Databeskyttelse** (`companies.privacy_contact_email`).
3. A customer may object on reasonable data-protection grounds within the notice period; if the
   objection cannot be resolved, the customer may terminate the affected feature or the contract.
4. Every sub-processor is bound by a written agreement imposing the same duties DCA owes the
   customer (Art. 28(4)).

Standing PR question: *does this change add a sub-processor or a personal-data field?*
If yes, this file and [ropa.md](ropa.md) change in the same commit.

---

## 4. Verification log and open items

| Checked | Vendor | Finding | Source |
|---|---|---|---|
| 2026-08-14 | Resend (Plus Five Five, Inc.) | DPF-certified (EU-U.S. + UK extension); DPA also incorporates SCCs modules 2 and 3 | resend.com/legal/dpa, resend.com changelog "Data Privacy Framework Certification" |
| 2026-08-14 | Postmark (ActiveCampaign, LLC) | DPF-certified, effective 2023-07-11 (EU), 2023-10-12 (UK), 2024-09-15 (CH) | activecampaign.com/legal/dpf, postmarkapp.com/dpa |
| 2026-08-14 | Google LLC | DPF-certified, covering Google LLC and its wholly-owned US subsidiaries; SCCs additionally incorporated for Cloud/business services | policies.google.com/privacy/frameworks |
| 2026-08-14 | Anthropic PBC | **No DPF claim on Anthropic's own pages.** The privacy policy names Art. 45 adequacy and Art. 46 SCCs; the commercial DPA includes SCCs automatically. Third-party summaries claiming DPF listing were contradictory and are not evidence. | anthropic.com/legal/privacy |
| 2026-08-14 | Supabase, Inc. | Not DPF-listed; relies on SCCs (EU + UK addendum) in its DPA | supabase.com/legal/dpa |

**Open items — do these before the register is handed to a customer:**

1. **Look each US vendor up on the official list** at `dataprivacyframework.gov/list` and record
   the certification ID and status date here. (The list page renders client-side and could not be
   queried programmatically on 2026-08-14; the rows above rest on the vendors' own statements.)
2. **Confirm the AWS region** of `ftp.predictioninstitute.com` / `operia.predictioninstitute.com`
   and record it in row 2. If it is not an EU region, move it.
3. **Execute or confirm the DPA with each vendor** (Supabase, Resend, Postmark, GatewayAPI,
   Mistral, Anthropic, Google, HeiGIT) and file a copy; note the date here.
4. **Write one short TIA** per US vendor (rows 1–4, 7, 8) — `docs/gdpr/tia/`.
5. **Move the AI keys to paid plans** before any customer reads real labels (§2).

---

## 5. EU-only configuration

A customer who requires that no personal data leaves the EU/EEA can run Operia that way today
by configuring:

| Setting | EU-only choice |
|---|---|
| AI label reading | **Mistral** (FR) — or the feature disabled entirely |
| Maps provider | **OpenRouteService** (DE) — the default |
| SMS | GatewayAPI (DK) — the only option |
| Email | **Not yet possible** — Resend (US) and Postmark (US) have no EU alternative wired in. This is the remaining gap for a true "EU-only mode"; an EU sending provider is the fix. |
| Log drain | The customer's own EU destination |

The core platform (database, storage, auth, functions) is already in `eu-north-1`.

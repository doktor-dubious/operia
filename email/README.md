# Operia inbound-email gateway (Postmark **or** Brevo)

The receiving leg of the **automatic-email** data-transfer channel. A customer's
HR system emails the employee CSV to a per-tenant address (e.g.
`nordwind@operia.predictioninstitute.com`); the inbound provider receives it via
MX records, parses the message, and POSTs it as JSON to the Supabase edge
function `email-inbound`. From there it's the **same** Flow 0 pipeline as SFTP
(`imports/{company_id}/` → `inbound_files` → `import_runs`).

**Two providers are supported, and the function accepts both payload shapes at
once** — so the MX record can be moved with no downtime. Which one is *current*
is recorded on Operia → Integrationer → E-mail (`platform_settings.
email_inbound_provider`); that setting drives the DNS guidance in the UI, not the
runtime.

| | Postmark (US) | Brevo (EU/FR) |
|---|---|---|
| MX | `10 inbound.postmarkapp.com` | `10 inbound1.sendinblue.com`, `20 inbound2.sendinblue.com` |
| Payload | one object, `MessageID` / `OriginalRecipient` / `Headers[]` | `items[]`, `MessageId` / `Recipients[]` / `Headers{}` |
| Attachments | base64 **in** the payload | **not** in the payload — fetched with `DownloadToken` via `GET /v3/inbound/attachments/{token}` (needs the Brevo API key) |
| Webhook auth | basic auth in the URL | `?token=…` in the URL |

The mapping lives in `supabase/functions/_shared/inbound-mail.ts`; everything
after it (sender verification, allowlist, import) is provider-agnostic.

```
HR system → email → inbound provider (MX: Postmark or Brevo)
          → POST JSON (Postmark: attachments inline; Brevo: DownloadTokens)
          → email-inbound (Supabase)  →  imports/{company_id}/
          → processInboundImport  →  employees upserted
```

The per-tenant address's **local part is the `email_name`** stored (platform-admin
only) on the customer in Operia → Data Transfer. It is globally unique, so the
edge function maps `nordwind@…` → `email_name = 'nordwind'` → company.

## Why Postmark and not Cloudflare Email Routing

Cloudflare Email Routing must be authoritative for the **whole zone** (subdomain
zones are Enterprise-only), which would mean moving all of
`predictioninstitute.com` to Cloudflare and disturbing the other customers on it.
Postmark works off a **single MX record on the subdomain** — only mail to
`*@operia.predictioninstitute.com` is affected; nothing else on the domain moves.
When Operia gets its own domain, point that domain's MX at Postmark instead and
update `email_base_domain` in Operia → Data Transfer. No code change.

## One-time Postmark setup (US)

1. **Create a Postmark account** and a **Server** (inbound is free). In the server,
   open the **Inbound** stream.
2. **Set the inbound domain.** Server → Inbound → *Inbound Domain Forwarding* →
   set it to your tenant domain, e.g. `operia.predictioninstitute.com`. Postmark
   shows the MX target (`inbound.postmarkapp.com`).
3. **Add the MX record** at whatever host runs `predictioninstitute.com`'s DNS
   (NOT Cloudflare):
   ```
   operia   MX   10   inbound.postmarkapp.com
   ```
   (host = `operia`, i.e. the record is on `operia.predictioninstitute.com`.) This
   is surgical — it only routes mail for that subdomain; `www`, `cassandra`, `ftp`
   and apex mail are untouched. Optionally add SPF later; not required for inbound.
4. **Set the webhook.** Server → Inbound → *Webhook* →
   ```
   https://hook:<EMAIL_HOOK_SECRET>@rjlxmdfmktucunxehtqz.supabase.co/functions/v1/email-inbound
   ```
   (HTTP basic auth — Postmark moves the secret into the `Authorization` header,
   so it never appears in URL/query logs. The legacy
   `…/email-inbound?token=<EMAIL_HOOK_SECRET>` form is still accepted.)
   Leave "Include raw email content" off; keep attachments **included** (default).
5. That's it — no Worker, no deploy. The Supabase function is already live.

`EMAIL_HOOK_SECRET` is the shared guard on the webhook URL, matching the Supabase
edge secret of the same name:

```bash
# already generated + set on Supabase this session; rotate with:
openssl rand -hex 32
supabase secrets set EMAIL_HOOK_SECRET=<value>   # run from repo root
# then paste the same value into Postmark's webhook URL (basic-auth password)
```

## One-time Brevo setup (EU)

Brevo (Sendinblue SAS, Paris) processes in the EU/EEA and is what an all-EU
setup needs — see `docs/gdpr/subprocessors.md` §5. It is also the outbound
provider option, so one account and one API key covers both directions.

1. **Create a Brevo account** and generate a **v3 API key** (Brevo → SMTP & API →
   API keys). Paste it on **Operia → Integrationer → E-mail**; it is stored in
   `platform_secrets['brevo_api_key']` and can never be read back from the
   browser. (`BREVO_API_KEY` as an edge secret is the local/dev fallback.)
2. **The receiving domain must differ from the sending domain.** Our subdomain
   split already satisfies this: we send from `predictioninstitute.com` and
   receive on `operia.predictioninstitute.com`.
3. **Add the MX records** at whoever hosts `predictioninstitute.com`'s DNS:
   ```
   operia   MX   10   inbound1.sendinblue.com.
   operia   MX   20   inbound2.sendinblue.com.
   ```
4. **Create the inbound webhook** (there is no UI for inbound webhooks — use the
   API):
   ```bash
   curl -X POST https://api.brevo.com/v3/webhooks \
     -H "api-key: $BREVO_API_KEY" -H 'Content-Type: application/json' \
     -d '{"type":"inbound","events":["inboundEmailProcessed"],
          "domain":"operia.predictioninstitute.com",
          "url":"https://rjlxmdfmktucunxehtqz.supabase.co/functions/v1/email-inbound?token=<EMAIL_HOOK_SECRET>",
          "description":"Operia Flow 0 CSV ingest"}'
   ```
   Brevo does **not** support basic auth in the webhook URL the way Postmark
   does, so the `?token=` form carries the secret here.
5. **Switch the selection** on Operia → Integrationer → E-mail once the MX
   records have propagated. The function already accepted both shapes, so the
   cutover is only bookkeeping.

## Test without real DNS

Postmark's server has a **"Check" / send-test** for inbound, or POST a Postmark-
shaped payload straight at the function (bypassing Postmark) — see the curl test
in the repo's data-transfer notes. Once the MX + webhook are live, email a `.csv`
attachment to `<email_name>@<base-domain>` and watch the row appear in
Operia → Logs (category *Imports*) and the employees update.

## Notes

- Only the first **CSV** attachment is used; mail without one is ignored (200 —
  the provider won't retry). Unknown recipient / disabled channel / bad domain
  are also ignored with 200 so the provider doesn't hammer retries.
- Real failures (storage/insert) return 5xx so the provider retries.
- Brevo can deliver **several messages in one POST** (`items[]`). Each is handled
  on its own and one rejection does not spoil the others; the response carries a
  `results` array. A hard failure on any of them makes the whole response non-2xx
  so the batch is retried — the `(source, message_id)` unique index makes the
  already-imported ones a no-op.
- Provider-agnostic underneath: `email-inbound` and `sftp-uploaded` converge on
  the same `_shared/import-runner.ts`. Adding a third MX provider is a matter of
  one more normalizer in `_shared/inbound-mail.ts`.

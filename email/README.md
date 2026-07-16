# Operia inbound-email gateway (Postmark inbound)

The receiving leg of the **automatic-email** data-transfer channel. A customer's
HR system emails the employee CSV to a per-tenant address (e.g.
`nordwind@operia.predictioninstitute.com`); **Postmark** receives it via a single
MX record, parses the message, and POSTs it as JSON (attachments already
base64-encoded) to the Supabase edge function `email-inbound`. From there it's the
**same** Flow 0 pipeline as SFTP (`imports/{company_id}/` → `inbound_files` →
`import_runs`).

```
HR system → email → Postmark inbound (MX: …→ inbound.postmarkapp.com)
          → POST JSON {OriginalRecipient, FromFull, Attachments[]} (base64)
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

## One-time Postmark setup

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

## Test without real DNS

Postmark's server has a **"Check" / send-test** for inbound, or POST a Postmark-
shaped payload straight at the function (bypassing Postmark) — see the curl test
in the repo's data-transfer notes. Once the MX + webhook are live, email a `.csv`
attachment to `<email_name>@<base-domain>` and watch the row appear in
Operia → Logs (category *Imports*) and the employees update.

## Notes

- Only the first **CSV** attachment is used; mail without one is ignored (200 —
  Postmark won't retry). Unknown recipient / disabled channel / bad domain are
  also ignored with 200 so Postmark doesn't hammer retries.
- Real failures (storage/insert) return 5xx so Postmark retries.
- Provider-agnostic underneath: `email-inbound` and `sftp-uploaded` converge on
  the same `_shared/import-runner.ts`. Swapping Postmark for another MX provider
  is just re-mapping the webhook fields at the top of `email-inbound`.

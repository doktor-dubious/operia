# Notification channels — state, and how to set them up in production

**Purpose:** the four parcel-notification channels, where each one stands, and the exact
steps to recreate Slack on a production account. Written 2026-09-04, when Teams was
parked.

**Related:** [`teams-app/README.md`](../teams-app/README.md) (Teams package + architecture),
[`email/README.md`](../email/README.md) (the *inbound* email leg, which has its own provider choice),
[`docs/gdpr/subprocessors.md`](gdpr/subprocessors.md) (Slack is a sub-processor),
[`docs/disaster-recovery.md`](disaster-recovery.md) (what git does and doesn't hold).

---

## 1. Where each channel stands

| Channel | State | Notes |
|---|---|---|
| **Email** (Resend **or** Brevo) | Live | Original channel. Since 2026-09-08 the provider is a platform choice on Operia → Integrationer → E-mail — see §5. |
| **SMS** (GatewayAPI) | Live | Gated on the `sms_notifications` add-on. |
| **Slack** | **Live and verified end-to-end** | Sends a DM to the recipient. Gated on `slack_notifications` + a per-customer OAuth install. |
| **Teams** | **Parked — see §4** | Bot registered and authenticating; sender not written. Blocked on a tenant that actually has Teams. |

Three streams send over these channels, each with its own master switch, settings, templates
and message log: **parcels** (`dispatch-parcel-notifications`), **asset loans**
(`dispatch-asset-reminders`, email/SMS only) and, since 2026-09-08, **bookings**
(`dispatch-booking-notifications` — EVU requirement A-04). The booking stream reads its work
out of the append-only `booking_events` log rather than polling for state, so every create,
change, cancellation and invoicing mark is confirmed exactly once; reminders are found by
looking ahead in the calendar. Its settings live on Operia → Notifikationer and
Konfigurér → Notifikationer under the type **Booking-flow**, and it adds two per-customer
addresses: a copy recipient for every booking message and an invoicing mailbox that is the
sole recipient of the "sent for invoicing" message.

All four channels are described **once** in `supabase/functions/_shared/channels.ts`. The dispatcher
does not know channel names: a channel's add-on, toggle column, recipient field, template
suffix, rendering and sender all live in that registry. Adding a fifth means a migration
(enum value, toggle columns, templates) plus one entry there — not edits across the
dispatcher, the test function and the UI.

### The gates, in order

Nothing sends until **all** of these are true. This is deliberate: a channel that is
merely configured must never start messaging real people by itself.

1. The master switch for the stream that is sending — `platform_settings.parcel_notifications_enabled`,
   `asset_notifications_enabled` or `booking_notifications_enabled`. Each is independent: booking
   confirmations can be live while parcel notifications are off, and vice versa.
2. `platform_settings.<channel>_enabled` — DCA offers the integration at all (Slack only)
3. `company_features` holds the channel's add-on (`slack_notifications`, `sms_notifications`, …)
4. `companies.notify_<channel>_enabled` (null = inherit the platform default, which is `false`
   for everything except email)
5. For Slack: the customer has completed the OAuth install, so `company_slack_secret` holds a token
6. The recipient has an address on that channel

---

## 2. Slack — production setup runbook

Do these in order. Steps 1–4 are once per Slack app (i.e. once per environment);
steps 5–7 are once per customer.

### 2.1 Create the Slack app

1. **[api.slack.com/apps](https://api.slack.com/apps) → Create New App → From scratch.**
   Name it `Operia`. Pick any workspace as the development home — it does not constrain
   who can install later.
2. **OAuth & Permissions → Bot Token Scopes**, add exactly these three:

   | Scope | Why |
   |---|---|
   | `chat:write` | send the message |
   | `users:read` | **required** — `users:read.email` is a modifier on it, not a standalone scope |
   | `users:read.email` | find the employee by email address |

   Do not add `im:write`. It is the documented scope for `conversations.open`, but we
   deliberately do not call that method — see §3.

3. **OAuth & Permissions → Redirect URLs → Add New Redirect URL:**

   ```
   https://<PROJECT_REF>.supabase.co/functions/v1/slack-oauth
   ```

   Exact string, no trailing slash, `https`. **Then click "Save URLs"** — the separate
   green button below the list. Adding the row without saving silently discards it, and
   the failure only appears later as `redirect_uri did not match any configured URIs`.

4. **Basic Information → App Credentials**: copy *Client ID*, *Client Secret*,
   *Signing Secret*.

### 2.2 Store the credentials

Root `.env` (gitignored):

```
SLACK_CLIENT_ID=…
SLACK_CLIENT_SECRET=…
SLACK_SIGNING_SECRET=…
```

Then as edge secrets:

```bash
supabase secrets set SLACK_CLIENT_ID=… SLACK_CLIENT_SECRET=… SLACK_SIGNING_SECRET=…
```

`slack-oauth` also needs **`APP_URL`** (the web app's public origin, e.g.
`https://operia.predictioninstitute.com`) — it is where the browser is sent back after
Slack's consent screen. It is the same secret the invite/password-reset functions use, so on
the linked project it is already set; a fresh project must set it. Without it the function
falls back to `http://localhost:5173`, which is right for `supabase functions serve` and
wrong for everything else.

`SLACK_SIGNING_SECRET` is **currently unused** — nothing reads it. It is stored because it
is the secret that verifies *inbound* requests from Slack, which we would need the day we
accept events (a user uninstalling, say). Keeping it now costs nothing and saves a
credential round-trip later. Do not confuse it with the client secret.

### 2.3 Deploy

```bash
supabase functions deploy slack-config --use-api
supabase functions deploy slack-oauth  --use-api --no-verify-jwt
supabase functions deploy dispatch-parcel-notifications send-test-status --use-api
```

Two things that will bite otherwise:

- **`--use-api` is mandatory.** Without it the CLI bundles through Docker; where Docker is
  not running it prints `No change found in Function` and `Deployed Functions.` and uploads
  **nothing**. Always confirm with `supabase functions list` that the version number moved.
- **`slack-oauth` must be `--no-verify-jwt`.** Slack redirects the user's *browser* there
  with no Supabase token. Its authorisation is the single-use `state` key issued by
  `slack-config`, not a JWT.

### 2.4 Turn the integration on

Platform admin → **Operia → Integrationer → Slack → "Udbyd Slack-integrationen"**.
(Sets `platform_settings.slack_enabled`; nothing appears for customers until then.)

### 2.5 Per customer: grant the add-on

**Operia → Kunder → *customer* → tilvalg → Slack-notifikationer.**

Skipping this is the most likely support call: the customer can tick the Slack channel and
connect their workspace, and it still will not send, because gate 3 is closed.

### 2.6 Per customer: connect the workspace

The customer's manager: **Konfigurér → Integrationer → Slack → "Forbind til Slack"** →
approve in their own workspace. Slack returns to `/configure/integrations?slack=connected`.

What happens under the hood: `slack-config` issues a single-use `state` (10-minute TTL,
stored in `slack_oauth_state`), `slack-oauth` exchanges the code for a bot token and stores
it in `company_slack_secret` — a table with **no RLS policies and no grants**, so it can
never be read through PostgREST. The UI only ever sees the mirrored `token_set` flag.

**"Test forbindelsen"** calls `auth.test`. It sends no message; it only proves the token is
still valid and names the workspace.

### 2.7 Per customer: enable the channel

**Konfigurér → Notifikationer → Kanaler → Slack.**

### 2.8 Verify

**Konfigurér → Notifikationer → Statusbesked → test button.** It sends to one recipient you
choose, and its log rows carry a `test-` prefix in `digest_key` so they never count toward
the real daily dedup or the retry limit.

Failures name the channel and reason (`Slack: Modtageren blev ikke fundet i Slack`). The raw
provider error is in `parcel_notifications.error`; a masked copy is in Logs.

### 2.9 Addressing, and the escape hatch

Slack can find people with `users.lookupByEmail` against `employees.email`. That is
self-maintaining — join the workspace and it starts working, leave and it fails cleanly —
but it is an **opt-in per customer** (`companies.slack_lookup_by_email`, the checkbox
*Find modtagere ud fra e-mailadresse* under Konfigurér → Integrationer → Slack). Off, only
employees with a Slack member id are addressed. The reason: with lookup on, the channel is
attempted for *every* employee with an e-mail, and each one who has no Slack account costs a
Tier-2 lookup (~20/min) plus a `failed` row and an error in Logs, up to three times per
reminder kind. Turn it on for customers where most staff are in Slack under the same
address; leave it off and fill in member ids otherwise. Negative lookups are cached for an
hour per isolate, and a 429/5xx from Slack pauses the customer's sends (dispatcher: rest of
the run; sender: until `retry-after`).

Transient failures (rate limit, 5xx, network, secret lookup) are **deferred**, not logged as
`failed` — they must not count against the three attempts. They are not silent either: the
dispatcher writes a `parcel.notifications_deferred` warning to Logs per customer/channel, at
most once an hour, with the deferred count and the reason, and every deferral goes to the
edge-function console. The booking dispatcher does the same under
`booking.notifications_deferred`, and writes `booking.notification_log_failed` (error) when a
message went out but its `booking_notifications` row could not be written — the next run
cannot see that send, so the recipient may get it twice. The daily status digest keeps a *per-channel* window, so a deferred
Slack digest is still owed everything since its own last send even if the e-mail went out.

When someone's Slack account uses a **different** address than their Operia record, fill in
**Slack-medlems-id** on the employee (Slack profile → ⋮ → Copy member ID, a `U…` value).
It is optional and empty by default; when set, the lookup is skipped entirely.

This field exists because `employees.email` is owned by the HR import / Entra sync and is
overwritten on every run — so "just correct the email" is not available to a manager. The
import never touches `slack_user_id`, and `anonymize_employee_internal` clears it.

### 2.10 Disconnecting

**Konfigurér → Integrationer → Slack → Afbryd.** Clears the token and connection state,
audit-logged as `slack.disconnected`. Reversible — reconnecting is the same OAuth flow.

---

## 3. Slack gotchas already paid for

Do not re-derive these.

| Symptom | Cause |
|---|---|
| `redirect_uri did not match any configured URIs` | The redirect URL was added but **"Save URLs" was not clicked**. |
| `Invalid permissions requested` at install | `users:read.email` requested without `users:read`. It is a modifier, not a standalone scope. |
| `invalid_arguments` from `users.lookupByEmail` | A JSON request body. Slack's Web API accepts JSON on only *some* methods; `users.lookupByEmail` is form-encoded only. We now send `application/x-www-form-urlencoded` for **all** calls — every parameter we pass is a simple string, so one encoding covers them. |
| `missing_scope` on `conversations.open` | That method needs `im:write`. **We removed the call** rather than adding the scope: `chat.postMessage` accepts a user ID directly as `channel` and opens the DM itself, needing only `chat:write`. One fewer permission to justify in a customer security review, one fewer API call, and no reinstall for already-connected customers. |
| Everything failed but the UI said "unknown" | When *all* channels fail, `send-test-status` returns the reasons inside `results` with no top-level `error`. Fixed — the dialog now reads `results`. |

**Rate limits.** `users.lookupByEmail` is Slack Tier 2 (~20/min) and is the tightest
constraint. `send-slack.ts` caches resolved user ids for 10 minutes and bot tokens for 30
seconds — the asymmetry is deliberate: email→user is stable, but a token cached too long
would keep messaging a workspace after the customer disconnected.

**Transient failures do not burn retries.** A 429 or 5xx returns `retryable: true`, and the
dispatcher logs *nothing* for those. Without that, three rate limits in a row would trip
`MAX_ATTEMPTS = 3` and abandon a real notification permanently. They surface as `deferred`
in the dispatcher's response.

---

## 4. Teams — parked 2026-09-04

### Done

- **Azure Bot registered** (`operia-notifications`, F0, single-tenant) in the Entra dev
  tenant `rfsskardhamar.onmicrosoft.com` (`82473350-…`). Its app registration was switched
  to **multitenant**, which is what makes cross-tenant possible now that multi-tenant *bot*
  creation is deprecated (after 2025-07-31).
- **Credentials verified.** `client_credentials` with scope
  `https://api.botframework.com/.default` returns a Bearer token. `TEAMS_APP_ID` and
  `TEAMS_APP_SECRET` are in root `.env`; **not** yet set as edge secrets.
- **Token endpoint settled empirically:** a single-tenant bot must use
  `https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token`. The shared
  `botframework.com` endpoint that multi-tenant bots used returns
  `AADSTS700016: Application not found in directory`.
- **App package built** — `teams-app/` (manifest + icons), `botId` set, `personal` scope,
  `isNotificationOnly: true`. Icons validated against Teams' rules (outline must be white
  and transparent only, exact 192×192 / 32×32).
- **Plumbing already in place** from the channel refactor: enum value, toggle columns,
  `teams_notifications` add-on, 8 templates (da/en × single/batch/reminders/status), reason
  codes and translations, reachability in web + handheld. Teams addresses on
  `employees.external_id`, which the Entra sync already writes.

### The blocker

The bot is registered in a **bare Entra "Default Directory"** with no Microsoft 365
licences — so that tenant has no Teams, nothing to install the app into, and nobody to
message. The ten users in it are directory objects for AD-sync testing.

The tenant where Teams is actually used is **`skardhamar.com`** (`e24583a9-…`), a separate
managed tenant. In the dev tenant the same person is only a **guest**
(`rfs_skardhamar.com#EXT#@…`), which is why signing in to the Teams admin center with
`rfs@skardhamar.com` fails.

This is not fatal — the multitenant app registration is exactly the configuration meant to
serve other tenants — but testing needs, in `skardhamar.com`:

1. Admin consent:
   `https://login.microsoftonline.com/skardhamar.com/adminconsent?client_id=<TEAMS_APP_ID>`
2. Custom app upload enabled, and `operia-teams.zip` uploaded to that tenant's catalog
3. The app installed for a user there

…and therefore Teams/global admin rights in `skardhamar.com`.

### Deliberately not written

`sendTeams()` is still a stub returning `teams_not_configured`. One design question cannot
be answered from the documentation and changes the shape of the code rather than a line of
it: **how to obtain a conversation to send into** — Graph `installedApps` + `$expand=chat`
(needs `TeamsAppInstallation.ReadWriteForUser.All`, admin-consented), or capturing the
`conversationUpdate` the bot receives at its messaging endpoint when the app is installed
(needs an inbound endpoint with Bot Framework JWT validation).

It is a ten-minute empirical check against a real tenant, and a rewrite if guessed. Slack
was the simpler API, testable live, and still cost three round trips of exactly this kind
of mistake.

### Also learned: production distribution

Sideloading a zip works for a pilot but **proactive messages can fail with 401**, because a
single-tenant bot only acquires tokens from its home tenant. Microsoft's supported route
for an ISV is **AppSource / Teams Store publication**, where Microsoft handles cross-tenant
install, consent and service-principal provisioning.

That moves store submission from "a finishing touch" to "the delivery path", and it runs on
Microsoft's review calendar. **Start it early if Teams is revived** — the original 1.5–2
week estimate did not include it.

### The cheap alternative

A **Power Automate Workflow webhook** posts to a Teams *channel*: no Azure, no bot, no admin
consent, no store submission. Roughly half a day. It is **not** FP Trax parity — no DM to
the named recipient — but it is a real Teams story for department-level pickup notices, and
it is demoable without any of the above.

---

## 5. Email — choosing a provider

Two outbound providers are wired in, and the choice is a single dropdown on
**Operia → Integrationer → E-mail** (`platform_settings.email_provider`). Both stay
fully working, so a disruption at one is a UI change, not a deploy.

| | Resend | Brevo | AhaSend |
|---|---|---|---|
| Vendor | Plus Five Five, Inc. (US) | Sendinblue SAS, Paris (**EU**) | TakTek GmbH, Vienna (**EU**) |
| API | `POST https://api.resend.com/emails`, `Authorization: Bearer` | `POST https://api.brevo.com/v3/smtp/email`, `api-key:` header | `POST https://api.ahasend.com/v2/accounts/{account_id}/messages`, `Authorization: Bearer` |
| Key lives in | edge secret `RESEND_API_KEY` | `platform_secrets['brevo_api_key']`, typed into the UI | `platform_secrets['ahasend_api_key']` + `platform_settings.ahasend_account_id` (an id, not a secret) |
| Success code | 200 | 201 | **202** — and the per-recipient row can still carry `error`, so the row is checked, not just the status |
| Message id | `id` (uuid) | `messageId` (`<…@smtp-relay.mailin.fr>`) | `data[0].id` |
| Link rewriting | off by default; if enabled, a subdomain of *your* domain | **forced, cannot be disabled** | off by default, and we also force it off per message |
| Bounce webhook | `resend-webhook` — Standard Webhooks, **`whsec_` base64-decoded** (`RESEND_WEBHOOK_SECRET`) | `brevo-webhook` — **unsigned by the provider**; the shared secret in the URL is the only guard (`BREVO_WEBHOOK_SECRET`) | `ahasend-webhook` — Standard Webhooks, **secret used as raw UTF-8** (`AHASEND_WEBHOOK_SECRET`) |

Everything else is shared: `_shared/send-email.ts` resolves the provider (cached one
minute per isolate, falling back to the edge secrets if the lookup fails) and both
webhooks converge on `_shared/mail-events.ts`, which matches the provider's message id
against `provider_id` and writes the outcome to `audit_log`.

**The sender.** `platform_settings.email_from` overrides the `RESEND_FROM`/`BREVO_FROM`
edge secret. Brevo only accepts a sender that is **verified in the account**, so the
Test-connection button also reports whether the current sender is on Brevo's sender list —
an unverified sender otherwise shows up as a silent 400 on the first real message.

### Brevo setup

```bash
# 1. Paste the v3 API key on Operia → Integrationer → E-mail (never in git).
# 2. Verify the sender domain/address in Brevo → Senders.
# 3. Bounce webhook — one secret, then register the URL with Brevo:
openssl rand -hex 32
supabase secrets set BREVO_WEBHOOK_SECRET=<value>
supabase functions deploy brevo-webhook --use-api --no-verify-jwt
```

Register the webhook in Brevo (Transactional → Settings → Webhook) for the events
`hard_bounce`, `soft_bounce`, `blocked`, `invalid_email`, `spam`, `error` with the URL

```
https://rjlxmdfmktucunxehtqz.supabase.co/functions/v1/brevo-webhook?token=<BREVO_WEBHOOK_SECRET>
```

`soft_bounce` is accepted and deliberately **ignored** — Brevo retries those itself, and a
temporarily full mailbox should not light up red in the customer's log.

### Brevo gotcha: a 201 does **not** mean it was sent (paid for on 2026-09-08)

Brevo's send API answers `201 {"messageId": "<…@smtp-relay.mailin.fr>"}` even when it is about to
throw the message away. Sender validation happens *after* the API call, and the rejection shows up
only as an `error` event:

```
Sending has been rejected because the sender you used noreply@predictioninstitute.com
is not valid. Validate your sender or authenticate your domain
```

So `email_sent: true` in the audit log means **the provider accepted it**, never "it was
delivered". The asynchronous half is what the webhook is for — `brevo-webhook` counts `error`
as a bounce, so once the webhook is registered this lands in Logs as `auth.password_reset_bounced`
at level `error`. Until it is registered, a rejection like this is invisible.

Brevo accepts a sender by either route, and both count:

1. the **address** is verified individually (Brevo → Senders, confirmation mail), or
2. the whole **domain** is authenticated (Brevo → Domains, DKIM/SPF DNS records).

Domain authentication is the one you want in production — it covers `noreply@`, `support@` and
anything else without a mailbox having to exist. The **Test forbindelse** button checks both and
says which sender it checked; it deliberately does not treat "only an individual sender exists" as
a pass for a different address on that domain.

Check it from the CLI with the account's API key:

```bash
curl -s -H "api-key: $KEY" https://api.brevo.com/v3/senders          # verified addresses
curl -s -H "api-key: $KEY" https://api.brevo.com/v3/senders/domains  # authenticated domains
curl -s -G -H "api-key: $KEY" --data-urlencode "messageId=<id>" \
     https://api.brevo.com/v3/smtp/statistics/events                 # what happened to one message
```

That last one is the delivery log we never had with Resend, whose key here is send-only.

### Brevo gotcha: authorised IPs block the API key (paid for on 2026-09-08)

Brevo has an **IP allowlist on API keys**. It starts in a "learning phase" that authorises the
IPs it sees, then activates blocking on its own. Supabase Edge Functions egress from **dynamic,
mostly IPv6** addresses, so blocking is guaranteed to trigger sooner or later. The symptom is a
`401` whose body is *not* about the key:

```
brevo_401: We have detected you are using an unrecognised IP address 2406:da18:… .
If you performed this action make sure to add the new IP address in this link: …
```

**Fix:** Brevo → account dropdown → **Settings → Security → Authorised IPs** → either
*Deactivate blocking* or pick *Allow unknown IP addresses to make API calls without review*.
Allowlisting individual addresses cannot work — there is no stable egress IP to list. Brevo also
emails an "authorise this IP" link when it blocks one; that only fixes the one address.

This failure is now **visible** rather than silent: `request-password-reset` writes the provider's
error into the audit row (`email_sent: false`, `email_error`, level `error`), which is exactly how
it was found.

### Bounces on account mail (reset + invite)

Reset and invite mail used to store no message id, so a hard bounce on them matched nothing in
`resend-webhook`/`brevo-webhook` and was acknowledged and dropped — "I never got the mail" could
be neither confirmed nor denied. Since `20260908170000` the send records the provider's message id
in **`account_emails`** (a match index: masked recipient only, rows dropped after 30 days), and
`_shared/mail-events.ts` matches it and logs:

| Event | Action | Level |
|---|---|---|
| hard bounce | `auth.password_reset_bounced` / `user.invite_bounced` | **error** |
| spam complaint | `auth.password_reset_complained` / `user.invite_complained` | **warning** |

The same commit added the missing `booking_notifications` branch, so all four message logs are now
covered, and restored a rule in `audit_level` that `20260908160000` had silently dropped (a failed
reset mail was scoring `success` instead of `error`).

**When you redefine `audit_level`, copy the live body** (`pg_get_functiondef`) and add your branch.
Several migrations redefine it, and writing it from memory rolls back an earlier one's rule without
any error.

### Testing edge functions locally: grant `service_role` first

`supabase db reset --local` does **not** give `service_role` the same privileges the hosted
project has. Measured 2026-09-08: **61 tables** lacked `service_role` SELECT locally, **0** in
production. Production and a rebuild into another hosted project are unaffected — this is an
artefact of the local CLI stack only.

It matters because it makes local testing lie. `supabase-js` does not throw on a missing
privilege — the query just comes back empty — so `isPlatformAdmin()` returned false (403 from
`mail-config`) and `mailConfig()` fell back to Resend without a word. After every local reset:

```bash
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -c "grant select on all tables in schema public to service_role;"
```

(`20260908170000` grants `account_emails` and `platform_secrets` explicitly, so those two work
without the blanket grant. Its comment describes this as a rebuild risk — that is overstated;
the measurement above is the accurate version.)

### AhaSend

Added 2026-09-08 as a third outbound provider, specifically because it is the only one of the
three that is **both EU-hosted and leaves links alone**. Open and click tracking are off by
default, and `_shared/send-email.ts` additionally sets `ahasend-track-opens: false` and
`ahasend-track-clicks: false` on every message, so switching tracking on account-wide cannot
start wrapping password-reset links behind our back.

Two config values, not one: the API key (secret, in `platform_secrets`) and the **account id**,
a UUID that forms part of the send URL. The account id is not a secret and lives in
`platform_settings.ahasend_account_id`, editable in the UI.

**The `202` trap.** AhaSend answers `202 Accepted` with a list of one row per recipient, and a
row can carry `error` even though the HTTP status was a success — the same shape of trap as
Brevo's "201 then rejected". The sender therefore inspects `data[0].error`, not just the status.

**The signature trap.** AhaSend follows Standard Webhooks like Resend, with one difference their
docs call out: the secret is used as **raw UTF-8 bytes**, where Svix/Resend strips `whsec_` and
base64-decodes. Get it wrong and nothing errors — every webhook just fails verification silently.
`_shared/standard-webhook.ts` takes `keyMode` as a required argument for exactly that reason;
both modes are covered by the local signing test described in that file's header.

**The secret comes FROM AhaSend — do not invent one.** This is the opposite of Brevo, where we
generate a token and put it in the URL. AhaSend generates the signing secret when the webhook is
created and returns it **once**, in the `secret` field of the 201 response; it cannot be read back
afterwards. Generating our own with `openssl rand` would leave every webhook failing verification
in silence, since a wrong key produces no error — only a signature that never matches.

Create the webhook, then copy the returned secret into the edge secret:

```bash
curl -X POST "https://api.ahasend.com/v2/accounts/$ACCOUNT_ID/webhooks" \
  -H "Authorization: Bearer $AHASEND_API_KEY" -H 'Content-Type: application/json' \
  -d '{"name":"Operia bounce",
       "url":"https://rjlxmdfmktucunxehtqz.supabase.co/functions/v1/ahasend-webhook",
       "scope":"global","enabled":true,
       "on_bounced":true,"on_failed":true,"on_suppressed":true}'
# → 201 { ..., "secret": "..." }   ← this value, once only

supabase secrets set AHASEND_WEBHOOK_SECRET='<the secret from the response>'
supabase functions deploy ahasend-webhook --use-api --no-verify-jwt
```

`on_suppressed` matters: it means the address is on AhaSend's suppression list and the message was
never sent — otherwise indistinguishable from a success. `on_transient_error` is deliberately left
off; a greylisting deferral is normal and should not light up red in the customer's log (observed
in production 2026-09-08: one.com greylisted the first message, AhaSend retried ~20 minutes later
and it delivered).

If the secret is ever lost, delete the webhook and create a new one — there is no way to re-read it.

// brevo-webhook — Brevos sidestykke til resend-webhook: leverings-udfald der
// først sker ASYNKRONT (efter API'et har kvitteret 201) fanges her.
//
// Brevo sender ét event pr. POST med feltet "message-id" — den samme streng
// send-kaldet returnerede som messageId og som vi gemte i provider_id. Selve
// matchningen og logningen er fælles for begge udbydere og bor i
// _shared/mail-events.ts.
//
// Vinkelparenteserne er det eneste sted de to kan gå fra hinanden: et
// Message-ID er "<id@domæne>", og udbydere er ikke enige om hvorvidt de skal
// med. Derfor prøves den anden form, hvis den første ikke rammer noget — det
// koster ét opslag i det sjældne tilfælde og gør webhooken robust over for
// formen.
//
// Eventnavne (https://developers.brevo.com/docs/transactional-webhooks):
//   hard_bounce, blocked, invalid_email, error → BOUNCE  (error i Logs)
//   spam                                       → KLAGE   (warning i Logs)
//   soft_bounce                                → ignoreres bevidst: Brevo prøver
//     selv igen, og en midlertidig fuld postkasse skal ikke lyse rødt hos kunden
//   delivered/opened/click/…                   → kvitteres uden at logge
//
// SIKKERHED: Brevo signerer IKKE sine webhooks (ingen HMAC, ingen Svix) —
// derfor er den delte hemmelighed URL'ens/headerens eneste værn, præcis som
// Postmark-hooken. Sæt webhook-URL'en som
//   https://…/functions/v1/brevo-webhook?token=<BREVO_WEBHOOK_SECRET>
// (eller send X-Operia-Hook-Secret, hvis webhooken oprettes via API'et med
// egne headere). Uden BREVO_WEBHOOK_SECRET afvises ALT (fail closed).
// Deployes MED --no-verify-jwt (Brevo sender ingen Supabase-JWT).
//
// Notifikationsrækkernes status røres ikke — se resend-webhook for hvorfor.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { hookAuthorized } from '../_shared/hook-auth.ts'
import { recordMailOutcome } from '../_shared/mail-events.ts'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// Kun de felter vi bruger; Brevo sender en del flere (date, ts, tags, …).
type BrevoEvent = {
  event?: string
  'message-id'?: string
  messageId?: string
  email?: string
  reason?: string
  subject?: string
}

const BOUNCE_EVENTS = new Set(['hard_bounce', 'blocked', 'invalid_email', 'error'])

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!hookAuthorized(req, 'BREVO_WEBHOOK_SECRET')) return json({ error: 'unauthorized' }, 401)

  let event: BrevoEvent
  try {
    event = await req.json()
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  const type = (event.event ?? '').toLowerCase()
  const messageId = event['message-id'] ?? event.messageId
  const isBounce = BOUNCE_EVENTS.has(type)
  const isComplaint = type === 'spam'
  if (!messageId || (!isBounce && !isComplaint)) return json({ ok: true, ignored: type })

  const reason = isBounce ? event.reason?.trim() || type : 'spam complaint'

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const outcome = { kind: isBounce ? ('bounce' as const) : ('complaint' as const), reason, event: type }
  let matched = await recordMailOutcome(admin, { ...outcome, providerId: messageId })
  if (!matched) {
    const alternate = messageId.startsWith('<') && messageId.endsWith('>')
      ? messageId.slice(1, -1)
      : `<${messageId}>`
    matched = await recordMailOutcome(admin, { ...outcome, providerId: alternate })
  }
  // Ukendt message-id (fx invitations-/velkomstmail, som ikke spores) kvitteres
  // uden at logge, så Brevo ikke gen-forsøger.
  return json({ ok: true, matched })
})

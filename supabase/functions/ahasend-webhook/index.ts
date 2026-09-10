// ahasend-webhook — AhaSends leverings-udfald, så en e-mail der fejler
// ASYNKRONT (efter API'et har kvitteret 202 "queued") alligevel fanges.
//
// Sidestykke til resend-webhook og brevo-webhook: kun oversættelsen af
// udbyderens eventnavne bor her, mens matchning og logning er fælles i
// _shared/mail-events.ts (parcel-, asset-, booking- og konto-mails).
//
// Events (https://ahasend.com/docs/api-reference/webhooks):
//   message.bounced     → BOUNCE (error i Logs) — modtageren afviste permanent
//   message.failed      → BOUNCE (error)        — kunne ikke leveres
//   message.suppressed  → BOUNCE (error)        — adressen står på AhaSends
//     undertrykkelsesliste, så beskeden blev aldrig sendt. Den er tavs på alle
//     andre måder og ville ellers ligne en vellykket afsendelse.
//   message.transient_error → ignoreres: AhaSend prøver selv igen
//   message.delivered/opened/clicked, suppression.created → kvitteres uden log
//
// SIKKERHED: Standard Webhooks-signatur (webhook-id/-timestamp/-signature),
// verificeret mod AHASEND_WEBHOOK_SECRET. Bemærk keyMode 'raw' — AhaSend bruger
// hemmeligheden som rå UTF-8, hvor Resend base64-dekoder den; se
// _shared/standard-webhook.ts. Deployes MED --no-verify-jwt.
//
// Notifikationsrækkernes status røres ikke — se resend-webhook for hvorfor.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { recordMailOutcome } from '../_shared/mail-events.ts'
import { verifyStandardWebhook } from '../_shared/standard-webhook.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, webhook-id, webhook-timestamp, webhook-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// Kun de felter vi bruger; AhaSend sender flere (account_id, subject, from …).
type AhaSendEvent = {
  type?: string
  data?: {
    id?: string
    recipient?: string
    delivery_attempt?: {
      smtp_code?: number
      enhanced_status_code?: string
      response?: string
      description?: string
      classification?: string
    }
  }
}

const BOUNCE_EVENTS = new Set(['message.bounced', 'message.failed', 'message.suppressed'])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const secret = Deno.env.get('AHASEND_WEBHOOK_SECRET')
  if (!secret) return json({ error: 'webhook_not_configured' }, 500)

  const id = req.headers.get('webhook-id')
  const timestamp = req.headers.get('webhook-timestamp')
  const signature = req.headers.get('webhook-signature')
  const body = await req.text()
  if (!id || !timestamp || !signature) return json({ error: 'missing_signature' }, 400)
  if (!(await verifyStandardWebhook({
    secret,
    id,
    timestamp,
    signatureHeader: signature,
    body,
    keyMode: 'raw',
  }))) {
    return json({ error: 'bad_signature' }, 401)
  }

  let event: AhaSendEvent
  try {
    event = JSON.parse(body)
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  const type = (event.type ?? '').toLowerCase()
  const messageId = event.data?.id
  if (!messageId || !BOUNCE_EVENTS.has(type)) return json({ ok: true, ignored: type })

  const attempt = event.data?.delivery_attempt
  const reason = type === 'message.suppressed'
    ? 'suppressed (address on AhaSend suppression list)'
    : attempt?.description ||
      attempt?.response ||
      [attempt?.smtp_code, attempt?.classification].filter(Boolean).join(' ') ||
      type

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const matched = await recordMailOutcome(admin, {
    providerId: messageId,
    kind: 'bounce',
    reason: String(reason).slice(0, 300),
    event: type,
  })
  // Ukendt besked-id kvitteres uden at logge, så AhaSend ikke gen-forsøger.
  return json({ ok: true, matched })
})

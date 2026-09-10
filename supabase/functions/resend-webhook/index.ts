// resend-webhook — modtager Resends leverings-events, så et e-mail-udfald der
// først sker ASYNKRONT (efter API'et allerede har svaret 200) alligevel fanges.
//
// Resends send-API kvitterer kun "accepteret i køen" — om postkassen findes
// afgøres senere af den modtagende server. Et hårdt bounce (ukendt adresse) og
// en spam-klage kommer derfor tilbage som webhook-events, IKKE i send-svaret.
// Her oversættes Resends eventnavne til det fælles udfald, og
// _shared/mail-events.ts gør resten (match på provider_id → audit_log):
//   • email.bounced    → '*.reminder_bounced' / '*.notification_bounced' (error)
//   • email.complained → '*_complained'                                  (warning)
// Sidestykket for Brevo er brevo-webhook.
//
// SIKKERHED: Resend signerer webhooken via Svix (svix-id/-timestamp/-signature).
// Signaturen verificeres mod RESEND_WEBHOOK_SECRET i _shared/standard-webhook.ts,
// så ingen kan forfalske bounce-events. Deployes MED --no-verify-jwt (Resend sender ingen Supabase-JWT).
// Notifikationsrækkernes status RØRES bevidst ikke — dedup-indekset (status='sent')
// skal bestå, så cron ikke gen-sender til en død adresse; loggen bærer udfaldet.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { recordMailOutcome } from '../_shared/mail-events.ts'
import { verifyStandardWebhook } from '../_shared/standard-webhook.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, svix-id, svix-timestamp, svix-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

type ResendEvent = {
  type?: string
  data?: {
    email_id?: string
    to?: string[]
    bounce?: { message?: string; type?: string; subType?: string }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET')
  if (!secret) return json({ error: 'webhook_not_configured' }, 500)

  const id = req.headers.get('svix-id')
  const timestamp = req.headers.get('svix-timestamp')
  const signature = req.headers.get('svix-signature')
  const body = await req.text()
  if (!id || !timestamp || !signature) return json({ error: 'missing_signature' }, 400)
  // keyMode 'svix': Resends whsec_-hemmelighed base64-dekodes. AhaSend gør det
  // modsatte — se _shared/standard-webhook.ts.
  if (!(await verifyStandardWebhook({
    secret,
    id,
    timestamp,
    signatureHeader: signature,
    body,
    keyMode: 'svix',
  }))) {
    return json({ error: 'bad_signature' }, 401)
  }

  let event: ResendEvent
  try {
    event = JSON.parse(body)
  } catch {
    return json({ error: 'bad_json' }, 400)
  }

  const type = event.type ?? ''
  const emailId = event.data?.email_id
  // Vi handler kun på leveringsfejl; øvrige events (delivered/opened/…) kvitteres.
  const isBounce = type === 'email.bounced'
  const isComplaint = type === 'email.complained'
  if (!emailId || (!isBounce && !isComplaint)) return json({ ok: true, ignored: type })

  const reason = isBounce
    ? event.data?.bounce?.message ||
      [event.data?.bounce?.type, event.data?.bounce?.subType].filter(Boolean).join('/') ||
      'bounced'
    : 'spam complaint'

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const matched = await recordMailOutcome(admin, {
    providerId: emailId,
    kind: isBounce ? 'bounce' : 'complaint',
    reason,
    event: type,
  })
  // Ukendt email_id kvitteres uden at logge, så Resend ikke gen-forsøger.
  return json({ ok: true, matched })
})

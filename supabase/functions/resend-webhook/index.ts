// resend-webhook — modtager Resends leverings-events, så et e-mail-udfald der
// først sker ASYNKRONT (efter API'et allerede har svaret 200) alligevel fanges.
//
// Resends send-API kvitterer kun "accepteret i køen" — om postkassen findes
// afgøres senere af den modtagende server. Et hårdt bounce (ukendt adresse) og
// en spam-klage kommer derfor tilbage som webhook-events, IKKE i send-svaret.
// Her matches event'ets email_id mod provider_id på asset_loan_notifications /
// parcel_notifications, og udfaldet skrives til audit_log via
// log_notification_event, så det lyser i Logs:
//   • email.bounced   → '*.reminder_bounced' / '*.notification_bounced' (error)
//   • email.complained → '*_complained'                                  (warning)
//
// SIKKERHED: Resend signerer webhooken via Svix (svix-id/-timestamp/-signature).
// Signaturen verificeres mod RESEND_WEBHOOK_SECRET, så ingen kan forfalske
// bounce-events. Deployes MED --no-verify-jwt (Resend sender ingen Supabase-JWT).
// Notifikationsrækkernes status RØRES bevidst ikke — dedup-indekset (status='sent')
// skal bestå, så cron ikke gen-sender til en død adresse; loggen bærer udfaldet.

import { createClient } from 'jsr:@supabase/supabase-js@2'

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

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

// Svix-signaturverifikation (som Resend/Stripe-webhooks): HMAC-SHA256 over
// "{id}.{timestamp}.{body}" med den base64-dekodede whsec_-nøgle. Header'en kan
// bære flere signaturer (nøgle-rotation) adskilt af mellemrum som "v1,<sig>".
async function verifySvix(
  secret: string,
  id: string,
  timestamp: string,
  sigHeader: string,
  body: string,
): Promise<boolean> {
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  // Replay-værn: ±5 min (svix-timestamp er unix-sekunder).
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false

  const keyBytes = base64ToBytes(secret.replace(/^whsec_/, ''))
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)),
  )
  const expected = bytesToBase64(mac)
  for (const part of sigHeader.split(' ')) {
    const value = part.split(',')[1]
    if (value && timingSafeEqual(value, expected)) return true
  }
  return false
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
  if (!(await verifySvix(secret, id, timestamp, signature, body))) {
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

  // Matchen sker på provider_id (Resend-id gemt ved afsendelse). Nyeste række
  // vinder, hvis et id mod forventning skulle gå igen.
  const { data: assetRow } = await admin
    .from('asset_loan_notifications')
    .select('company_id, loan_id, asset_id, recipient, channel, loan:asset_loans(to_name), asset:assets(name, asset_tag)')
    .eq('provider_id', emailId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (assetRow) {
    const a = assetRow as unknown as {
      company_id: string
      loan_id: string
      asset_id: string | null
      recipient: string | null
      channel: string
      loan: { to_name: string | null } | null
      asset: { name: string | null; asset_tag: string | null } | null
    }
    // Marker lånet, så Låner-fanen kan vise en rød note — men KUN hvis lånets
    // aktuelle to_email stadig er den adresse der bouncede (ellers har manageren
    // allerede rettet den, og markeringen ville være forældet).
    if (isBounce && a.recipient) {
      await admin
        .from('asset_loans')
        .update({ bounced_at: new Date().toISOString(), bounce_reason: reason.slice(0, 300) })
        .eq('id', a.loan_id)
        .eq('to_email', a.recipient)
    }
    await admin.rpc('log_notification_event', {
      p_company_id: a.company_id,
      p_action: isBounce ? 'asset.reminder_bounced' : 'asset.reminder_complained',
      p_entity_type: 'asset_loan',
      p_entity_id: a.loan_id,
      p_summary: `${a.asset?.name || a.asset?.asset_tag || '—'} → ${a.loan?.to_name || a.recipient || '—'}`,
      p_detail: { channel: a.channel, recipient: a.recipient, reason, event: type },
    })
    return json({ ok: true, matched: 'asset' })
  }

  const { data: parcelRow } = await admin
    .from('parcel_notifications')
    .select('company_id, parcel_id, recipient, channel')
    .eq('provider_id', emailId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (parcelRow) {
    await admin.rpc('log_notification_event', {
      p_company_id: parcelRow.company_id,
      p_action: isBounce ? 'parcel.notification_bounced' : 'parcel.notification_complained',
      p_entity_type: 'parcel',
      p_entity_id: parcelRow.parcel_id,
      p_summary: parcelRow.recipient ?? '—',
      p_detail: { channel: parcelRow.channel, recipient: parcelRow.recipient, reason, event: type },
    })
    return json({ ok: true, matched: 'parcel' })
  }

  // Ukendt email_id (fx invitations-/velkomstmail, som ikke spores her) — kvittér
  // uden at logge, så Resend ikke gen-forsøger.
  return json({ ok: true, matched: null })
})

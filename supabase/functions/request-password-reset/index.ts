// request-password-reset — offentligt endpoint til "Glemt adgangskode?".
//
// Tager en email og sender et nulstillingslink via Resend (samme mønster som
// invite-user: generateLink + egen skabelon, i stedet for GoTrue's indbyggede
// SMTP). Linket lander på /welcome?mode=reset, hvor brugeren vælger ny kode.
//
// Anti-enumerering: svaret er ALTID {ok:true} uanset om kontoen findes, og
// intet i svaret afslører udfaldet. Kaldet er anonymt (brugeren er ikke logget
// ind); browseren sender anon-nøglen som bearer, hvilket gateway-JWT-tjekket
// accepterer — ingen bruger-session er nødvendig.
//
// Robusthed: HELE forløbet (env-læsning, createClient, RPC, generateLink) ligger
// i én try/catch, så selv en manglende env-variabel giver {ok:true} og ikke en
// 500. Det er ikke kosmetik: da createClient(url, serviceKey!) tidligere lå uden
// for try/catch, betød en tom injiceret SUPABASE_SERVICE_ROLE_KEY (fx efter en
// API-nøgle-rotation, hvor en gammel deploy ikke havde fået den friske nøgle) et
// uncaught throw → HTTP 500, før logning og mail — dvs. hverken e-mail eller
// revisionslog, og 500'en brød samtidig anti-enumereringen.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { sendResetEmail } from '../_shared/reset-email.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const appUrl = Deno.env.get('APP_URL') ?? 'http://localhost:5173'
    // Manglende platform-env ⇒ kan intet gøre; svar stadig ens (ingen 500,
    // ingen afsløring). Logges til edge-konsollen så driften kan opdage det.
    if (!url || !serviceKey) {
      console.error('request-password-reset: missing SUPABASE_URL / SERVICE_ROLE_KEY')
      return json({ ok: true })
    }

    const body = (await req.json().catch(() => ({}))) as { email?: string }
    const email = body.email?.trim().toLowerCase()
    // Tom/ugyldig email ⇒ svar ens (ingen fejl, ingen afsløring).
    if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) return json({ ok: true })

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

    // Log forsøget uanset udfald: kendt konto ⇒ attribueret, ukendt email ⇒
    // unknown_email=true. RPC'en slår selv kontoen op og flood-dæmper. Svaret er
    // stadig ens (anti-enumerering) — kun den platform-admin-synlige log skelner.
    // NB: rpc() returnerer en PostgREST-builder (thenable), IKKE et rigtigt
    // Promise — den har intet .catch, så vi await'er i en try i stedet.
    try {
      await admin.rpc('log_password_reset_requested', { p_email: email })
    } catch (_e) {
      // best-effort: logning må aldrig få kaldet til at fejle
    }

    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${appUrl}/welcome?mode=reset` },
    })
    // Ukendt email ⇒ generateLink fejler; slug fejlen og send ingen mail.
    if (!error) {
      const link = data.properties?.action_link
      if (link) await sendResetEmail(admin, email, link)
    }
  } catch (_e) {
    // Svar altid ok — afslør aldrig om kontoen findes, og lad aldrig en
    // uventet fejl blive til en 500.
  }
  return json({ ok: true })
})

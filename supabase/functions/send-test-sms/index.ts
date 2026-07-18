// send-test-sms — send en enkelt test-SMS via GatewayAPI, så DCA kan bekræfte
// afsender-id, token og hele send-sms.ts-stien fra appen.
//
// SIKKERHED (code review): dette må ikke være et åbent SMS-relay. Derfor:
//   • KUN platform-admins (DCA-personale) — ikke kunde-managers — så vilkårlige
//     numre ikke kan spammes fra det registrerede "Operia"-afsender-id på DCA's
//     GatewayAPI-regning.
//   • Beskeden er FAST (server-side); ingen kaldersupplieret tekst → intet
//     phishing-indhold kan sendes gennem endpointet.
// Browseren er utroværdig (se CLAUDE.md): rollen genverificeres server-side ud
// fra kalderens JWT. GATEWAYAPI_TOKEN forlader aldrig serveren.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { sendSms } from '../_shared/send-sms.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Fast testtekst — bevidst ikke kaldersupplieret (se sikkerhedsnoten ovenfor).
const TEST_MESSAGE = 'Operia: test-SMS. Afsendelse virker.'

type Body = { phone?: string }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // 1) Verificér kalderen ud fra deres egen JWT.
  const authHeader = req.headers.get('Authorization') ?? ''
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await asCaller.auth.getUser()
  if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401)
  const callerId = userData.user.id

  // 2) Validér input (kun modtagernummeret — beskeden er fast).
  const body = (await req.json().catch(() => ({}))) as Body
  const phone = body.phone?.trim()
  if (!phone) return json({ error: 'phone_required' }, 400)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  // 3) Autorisation: KUN platform-admin (DCA). Kunde-managers har ikke adgang.
  const { data: isPlatformAdmin } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', callerId)
    .maybeSingle()
  if (!isPlatformAdmin) return json({ error: 'forbidden' }, 403)

  // 4) Send test-SMS'en. Selve send-resultatet (også fejl fra GatewayAPI)
  //    returneres som 200 med { ok }, så UI'et kan vise det pænt — kun
  //    godkendelse/validering giver rigtige HTTP-fejl ovenfor.
  const result = await sendSms(phone, TEST_MESSAGE)
  return json({ ok: result.ok, id: result.id, error: result.error })
})

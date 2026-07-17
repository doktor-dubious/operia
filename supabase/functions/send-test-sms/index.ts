// send-test-sms — send en enkelt test-SMS via GatewayAPI, så vi kan bekræfte
// afsender-id, token og hele send-sms.ts-stien fra appen.
//
// Browseren er utroværdig (se CLAUDE.md): funktionen genverificerer server-side
// at kalderen er platform-admin eller manager, før den sender. Selve tokenet
// (GATEWAYAPI_TOKEN) forlader aldrig serveren. Dette er kun et test-endpoint —
// den rigtige påmindelses-dispatcher kommer separat.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { sendSms } from '../_shared/send-sms.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const DEFAULT_MESSAGE = 'Operia test-SMS'

type Body = { phone?: string; message?: string }

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

  // 2) Validér input.
  const body = (await req.json().catch(() => ({}))) as Body
  const phone = body.phone?.trim()
  const message = body.message?.trim() || DEFAULT_MESSAGE
  if (!phone) return json({ error: 'phone_required' }, 400)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  // 3) Autorisation: platform-admin eller en bruger med manager-rolle.
  const { data: isPlatformAdmin } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', callerId)
    .maybeSingle()

  let allowed = !!isPlatformAdmin
  if (!allowed) {
    const { data: managerRole } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', callerId)
      .eq('role', 'manager')
      .maybeSingle()
    allowed = !!managerRole
  }
  if (!allowed) return json({ error: 'forbidden' }, 403)

  // 4) Send test-SMS'en. Selve send-resultatet (også fejl fra GatewayAPI)
  //    returneres som 200 med { ok }, så UI'et kan vise det pænt — kun
  //    godkendelse/validering giver rigtige HTTP-fejl ovenfor.
  const result = await sendSms(phone, message)
  return json({ ok: result.ok, id: result.id, error: result.error })
})

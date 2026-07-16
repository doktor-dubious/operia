// maps-key-status — melder (uden at afsløre værdier) hvilke kort-/rute-API-nøgler
// der er sat som edge-secrets. Kun platform-admins. Nøglerne selv forlader
// aldrig serveren; kun boolean-status returneres. Bruges af Operia → Kort &
// ruter til at vise "Konfigureret / Ikke sat".

import { createClient } from 'jsr:@supabase/supabase-js@2'

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

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // 1) Verificér kalderen ud fra deres egen JWT.
  const authHeader = req.headers.get('Authorization') ?? ''
  const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userErr } = await asCaller.auth.getUser()
  if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401)

  // 2) Kun platform-admins (DCA) må se platformens nøglestatus.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: isAdmin } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userData.user.id)
    .maybeSingle()
  if (!isAdmin) return json({ error: 'forbidden' }, 403)

  // 3) Returnér KUN om hemmeligheden findes — aldrig værdien.
  return json({
    google: !!Deno.env.get('GOOGLE_MAPS_API_KEY'),
    openrouteservice: !!Deno.env.get('ORS_API_KEY'),
  })
})

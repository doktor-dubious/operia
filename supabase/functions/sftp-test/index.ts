// sftp-test — tester om en SFTP-vært er nåbar ved at åbne en TCP-forbindelse til
// port 22 med timeout. Kun platform-admins. Bemærk: edge-runtime kan ikke lave
// selve SSH-håndtrykket/-autentificeringen, så dette bekræfter KUN at porten er
// åben og tager imod forbindelser — en let, ærlig "nåbar?"-kontrol. Fuld
// login-test hører hjemme i selve SFTP-gateway'en.

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

// Host kan angives som "vært", "vært:port" eller IP. Standardport 22.
function parseHost(input: string): { host: string; port: number } | null {
  const raw = input.trim().replace(/^sftp:\/\//i, '')
  if (!raw) return null
  const m = raw.match(/^([^\s:/]+)(?::(\d{1,5}))?$/)
  if (!m) return null
  const port = m[2] ? parseInt(m[2], 10) : 22
  if (port < 1 || port > 65535) return null
  return { host: m[1], port }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // 1) Verificér kalderen.
  const authHeader = req.headers.get('Authorization') ?? ''
  const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userErr } = await asCaller.auth.getUser()
  if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401)

  // 2) Kun platform-admins.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: isAdmin } = await admin
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', userData.user.id)
    .maybeSingle()
  if (!isAdmin) return json({ error: 'forbidden' }, 403)

  // 3) Parse host + prøv TCP-forbindelse med timeout.
  let hostInput = ''
  try {
    hostInput = (await req.json())?.host ?? ''
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const target = parseHost(hostInput)
  if (!target) return json({ ok: false, reason: 'invalid_host' })

  const started = Date.now()
  try {
    const conn = await Promise.race([
      Deno.connect({ hostname: target.host, port: target.port }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ])
    ;(conn as Deno.Conn).close()
    return json({ ok: true, host: target.host, port: target.port, ms: Date.now() - started })
  } catch (e) {
    const reason = e instanceof Error && e.message === 'timeout' ? 'timeout' : 'unreachable'
    return json({ ok: false, host: target.host, port: target.port, reason })
  }
})

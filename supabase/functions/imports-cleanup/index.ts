// imports-cleanup — dagligt vedligehold af den automatiske ingest (SFTP+e-mail):
//   1) inbound_files der har hængt i 'received'/'processing' i over en time
//      markeres 'failed' — runneren døde undervejs (deploy, timeout, crash),
//      og rækken ville ellers stå som "i gang" for evigt.
//   2) objekter i imports-bucket'en ældre end RETENTION_DAYS slettes. Afviste/
//      fejlede filer beholdes til inspektion, men ikke for evigt (filerne
//      indeholder persondata — GDPR-minimering). Vellykkede imports sletter
//      allerede deres kilde-objekt selv.
// Kaldes dagligt af pg_cron med service-role-nøglen fra Vault (samme mønster
// som log-drain-dispatch); kan også kaldes manuelt.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const RETENTION_DAYS = 30
const STALE_MINUTES = 60
const MAX_DEPTH = 3 // {company_id}/… (+ evt. kunde-oprettede undermapper)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// Nøglen i Vault kan være en anden version end runtime'ns env-nøgle — afgør
// autorisation på JWT-rollen (exact match som fallback), som log-drain-dispatch.
function jwtRole(token: string): string | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const decoded = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)))
    return typeof decoded.role === 'string' ? decoded.role : null
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token || (jwtRole(token) !== 'service_role' && token !== serviceKey)) {
    return json({ error: 'unauthorized' }, 401)
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
    auth: { persistSession: false },
  })

  // 1) Hængende inbound_files → failed.
  const staleCutoff = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString()
  const { data: staled, error: staleErr } = await db
    .from('inbound_files')
    .update({ status: 'failed' })
    .in('status', ['received', 'processing'])
    .lt('received_at', staleCutoff)
    .select('id')
  if (staleErr) console.error('kunne ikke markere hængende inbound_files:', staleErr)

  // 2) Retention på imports-bucket'en (rekursivt, dybde-begrænset).
  const ageCutoff = Date.now() - RETENTION_DAYS * 86_400_000
  const expired: string[] = []
  let walkErrors = 0
  const walk = async (prefix: string, depth: number) => {
    if (depth > MAX_DEPTH) return
    const { data: entries, error } = await db.storage.from('imports').list(prefix, { limit: 1000 })
    if (error) {
      walkErrors++
      console.error(`list fejlede for '${prefix}':`, error)
      return
    }
    for (const entry of entries ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (!entry.id) {
        await walk(path, depth + 1) // mappe
      } else if (entry.created_at && new Date(entry.created_at).getTime() < ageCutoff) {
        expired.push(path)
      }
    }
  }
  await walk('', 0)

  let removed = 0
  for (let i = 0; i < expired.length; i += 100) {
    const batch = expired.slice(i, i + 100)
    const { error } = await db.storage.from('imports').remove(batch)
    if (error) console.error('remove fejlede:', error)
    else removed += batch.length
  }

  return json({ ok: true, staled: staled?.length ?? 0, removed, walkErrors })
})

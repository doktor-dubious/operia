// log-drain-dispatch — leverer audit_log-hændelser til de konfigurerede
// log-drains (Operia's udgave af Supabase "Log Drains"). To tilstande:
//
//   mode: 'dispatch'  — kaldes af pg_cron. Autoriseres med service-role-nøglen
//                       (sammenlignes mod SUPABASE_SERVICE_ROLE_KEY). Går alle
//                       aktive dræn igennem, sender nye hændelser i batches og
//                       rykker vandmærket (last_delivered_id) frem til sidste
//                       leverede batch. Fejler en batch, bevares vandmærket for
//                       det leverede → intet tabes, intet gensendes dobbelt.
//
//   mode: 'test'      — kaldes fra UI'et af en manager/platform-admin. Verificerer
//                       via kalderens JWT (RLS) at brugeren ejer drænet, sender én
//                       syntetisk testhændelse og returnerer HTTP-resultatet.
//                       Rykker IKKE vandmærket.
//
// Tre destinationer: generisk HTTP/NDJSON, Datadog, Grafana Loki. Hemmeligheden
// (token/api-nøgle) læses kun her (service-role) — aldrig i browseren.

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

const BATCH = 500 // hændelser pr. HTTP-kald
const MAX_BATCHES = 20 // max batches pr. dræn pr. kørsel (indhentning)

type AuditRow = {
  id: number
  created_at: string
  action: string
  entity_type: string
  entity_id: string | null
  summary: string | null
  company_id: string | null
  actor_user_id: string | null
  detail: unknown
}

type Drain = {
  id: string
  company_id: string | null
  name: string
  destination: 'http' | 'datadog' | 'loki'
  endpoint: string | null
  secret: string | null
  config: Record<string, unknown>
  last_delivered_id: number
}

// Fælles hændelsesform der sendes ud (uanset destination).
function shape(r: AuditRow) {
  return {
    id: r.id,
    timestamp: r.created_at,
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    company_id: r.company_id,
    actor_user_id: r.actor_user_id,
    summary: r.summary,
    detail: r.detail,
  }
}

type DeliveryResult = { ok: boolean; status: number; detail?: string }

async function deliver(drain: Drain, rows: AuditRow[]): Promise<DeliveryResult> {
  const cfg = drain.config ?? {}
  const secret = drain.secret ?? ''
  try {
    if (drain.destination === 'http') {
      if (!drain.endpoint) return { ok: false, status: 0, detail: 'missing_endpoint' }
      const headers: Record<string, string> = { 'Content-Type': 'application/x-ndjson' }
      if (secret) headers['Authorization'] = `Bearer ${secret}`
      // Ekstra faste headers fra config (fx custom auth-header).
      const extra = (cfg.headers ?? {}) as Record<string, string>
      for (const [k, v] of Object.entries(extra)) if (typeof v === 'string') headers[k] = v
      const body = rows.map((r) => JSON.stringify(shape(r))).join('\n')
      const res = await fetch(drain.endpoint, { method: 'POST', headers, body })
      return { ok: res.ok, status: res.status, detail: res.ok ? undefined : await safeText(res) }
    }

    if (drain.destination === 'datadog') {
      if (!secret) return { ok: false, status: 0, detail: 'missing_api_key' }
      const site = String(cfg.site ?? 'datadoghq.eu')
      const url = `https://http-intake.logs.${site}/api/v2/logs`
      const service = String(cfg.service ?? 'operia')
      const ddtags = cfg.ddtags ? String(cfg.ddtags) : undefined
      const payload = rows.map((r) => ({
        ddsource: 'operia',
        service,
        ...(ddtags ? { ddtags } : {}),
        hostname: String(cfg.hostname ?? 'operia'),
        message: r.summary || r.action,
        ...shape(r),
      }))
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'DD-API-KEY': secret },
        body: JSON.stringify(payload),
      })
      return { ok: res.ok, status: res.status, detail: res.ok ? undefined : await safeText(res) }
    }

    // loki
    if (!drain.endpoint) return { ok: false, status: 0, detail: 'missing_endpoint' }
    const base = drain.endpoint.replace(/\/$/, '')
    const url = base.endsWith('/loki/api/v1/push') ? base : `${base}/loki/api/v1/push`
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const username = cfg.username ? String(cfg.username) : ''
    if (username && secret) headers['Authorization'] = `Basic ${btoa(`${username}:${secret}`)}`
    else if (secret) headers['Authorization'] = `Bearer ${secret}`
    const labels = {
      app: 'operia',
      source: drain.company_id ?? 'platform',
      ...((cfg.labels ?? {}) as Record<string, string>),
    }
    const stream = {
      stream: labels,
      // Loki kræver ns-tidsstempler som strenge, i stigende rækkefølge (rows er
      // sorteret på id, som er stigende i tid).
      values: rows.map((r) => [
        (Date.parse(r.created_at) * 1_000_000).toString(),
        JSON.stringify(shape(r)),
      ]),
    }
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ streams: [stream] }),
    })
    return { ok: res.ok, status: res.status, detail: res.ok ? undefined : await safeText(res) }
  } catch (e) {
    return { ok: false, status: 0, detail: String((e as Error).message ?? e) }
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500)
  } catch {
    return ''
  }
}

// Læs rolle-claim'et fra et (allerede signatur-verificeret) JWT. Bruges til at
// afgøre om cron-kaldet kommer fra service-role — mere robust end at
// streng-sammenligne mod den nøjagtige nøgle (som varierer med nøgleversion/
// whitespace).
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

// Hent + lever nye hændelser for ét dræn (kun 'dispatch'). Returnerer antal
// leverede og evt. fejl; rykker vandmærket frem lokalt.
async function drainOne(
  admin: ReturnType<typeof createClient>,
  drain: Drain,
): Promise<{ delivered: number; result: DeliveryResult | null }> {
  let cursor = drain.last_delivered_id
  let delivered = 0
  let lastResult: DeliveryResult | null = null

  for (let i = 0; i < MAX_BATCHES; i++) {
    let q = admin
      .from('audit_log')
      .select('id, created_at, action, entity_type, entity_id, summary, company_id, actor_user_id, detail')
      .gt('id', cursor)
      .order('id', { ascending: true })
      .limit(BATCH)
    if (drain.company_id) q = q.eq('company_id', drain.company_id)
    const { data, error } = await q
    if (error) {
      // break (ikke return): vandmærket for allerede leverede batches skal
      // stadig persisteres nedenfor.
      lastResult = { ok: false, status: 0, detail: error.message }
      break
    }
    const rows = (data ?? []) as AuditRow[]
    if (rows.length === 0) break

    lastResult = await deliver(drain, rows)
    if (!lastResult.ok) break // fejl → stop, vandmærket rykkes ikke frem

    cursor = rows[rows.length - 1].id
    delivered += rows.length
    if (rows.length < BATCH) break
  }

  // Opdatér status/vandmærke (service-role → uden om RLS). Vandmærket rykkes
  // frem for ALT der nåede at blive leveret — også når en senere batch fejlede;
  // ellers gensendes de samme hændelser ved hver kørsel så længe fejlen varer.
  const patch: Record<string, unknown> = { last_run_at: new Date().toISOString() }
  if (delivered > 0) patch.last_delivered_id = cursor
  if (lastResult && !lastResult.ok) {
    patch.last_status = 'error'
    patch.last_error = `${lastResult.status}: ${lastResult.detail ?? ''}`.slice(0, 1000)
  } else if (delivered > 0) {
    patch.last_status = 'ok'
    patch.last_error = null
  }
  // Ingen ændring hvis intet nyt og ingen fejl (undgå unødig skrivning/log).
  if (patch.last_status || delivered > 0) {
    await admin.from('log_drains').update(patch).eq('id', drain.id)
  }
  return { delivered, result: lastResult }
}

const DRAIN_COLUMNS = 'id, company_id, name, destination, endpoint, secret, config, last_delivered_id'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const body = (await req.json().catch(() => ({}))) as { mode?: string; drainId?: string }
  const mode = body.mode ?? 'dispatch'
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')

  // ── Cron-dispatch: kun service-role (JWT-rolle 'service_role', med exact-
  // match som fallback) ─────────────────────────────────────────────────────
  if (mode === 'dispatch') {
    if (!token || (jwtRole(token) !== 'service_role' && token !== serviceKey)) {
      return json({ error: 'unauthorized' }, 401)
    }
    const { data, error } = await admin
      .from('log_drains')
      .select(DRAIN_COLUMNS)
      .eq('enabled', true)
    if (error) return json({ error: 'query_failed', detail: error.message }, 500)
    const drains = (data ?? []) as unknown as Drain[]
    let totalDelivered = 0
    const perDrain: { id: string; delivered: number; ok: boolean }[] = []
    for (const drain of drains) {
      const { delivered, result } = await drainOne(admin, drain)
      totalDelivered += delivered
      perDrain.push({ id: drain.id, delivered, ok: !result || result.ok })
    }
    return json({ ok: true, drains: drains.length, delivered: totalDelivered, perDrain })
  }

  // ── Test: kalderens JWT afgør (via RLS) om brugeren ejer drænet ────────────
  if (mode === 'test') {
    if (!body.drainId) return json({ error: 'drain_id_required' }, 400)
    const asCaller = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })
    const { data: userData, error: userErr } = await asCaller.auth.getUser()
    if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401)
    // RLS: kalderen kan kun læse dræn de har adgang til (uden secret-kolonnen).
    const { data: allowed } = await asCaller
      .from('log_drains')
      .select('id')
      .eq('id', body.drainId)
      .maybeSingle()
    if (!allowed) return json({ error: 'forbidden' }, 403)

    // Hent den fulde række (inkl. secret) via service-role og send én testhændelse.
    const { data: full, error: drErr } = await admin
      .from('log_drains')
      .select(DRAIN_COLUMNS)
      .eq('id', body.drainId)
      .single()
    if (drErr || !full) return json({ error: 'not_found' }, 404)
    const drain = full as unknown as Drain

    const now = new Date().toISOString()
    const testEvent: AuditRow = {
      id: 0,
      created_at: now,
      action: 'log_drain.test',
      entity_type: 'log_drain',
      entity_id: drain.id,
      summary: `Operia log drain test — ${drain.name}`,
      company_id: drain.company_id,
      actor_user_id: userData.user.id,
      detail: { test: true },
    }
    const result = await deliver(drain, [testEvent])
    // Notér testresultatet som status (uden at røre vandmærket).
    await admin
      .from('log_drains')
      .update({
        last_run_at: now,
        last_status: result.ok ? 'ok' : 'error',
        last_error: result.ok ? null : `${result.status}: ${result.detail ?? ''}`.slice(0, 1000),
      })
      .eq('id', drain.id)
    return json({ ok: result.ok, status: result.status, detail: result.detail ?? null })
  }

  return json({ error: 'unknown_mode' }, 400)
})

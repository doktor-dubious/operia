// dalux-sync — Dalux FM-integrationen (EVU B-05..B-10), første skive.
//
// Handlinger:
//   save_key / clear_key  → company_dalux_secret.api_key (manager eller platform-admin)
//   test                  → GET /2.0/buildings med nøglen; gemmer verified_at + et
//                           lille udsnit, og returnerer navnene på rummenes
//                           brugerdefinerede felter, så kunden kan vælge det,
//                           der bærer lokalets navn (et Room har intet navnefelt).
//   run                   → én synkroniseringskørsel: lokaler → ressourcer.
//                           Kaldes manuelt (manager) eller af cron (service-role).
//
// Nøglen går KUN denne vej: company_dalux_secret har hverken RLS-politikker
// eller grants, så den kan ikke læses gennem PostgREST. Browseren sætter en ny
// værdi og ser "sat ✓", men læser den aldrig igen (B-10).
//
// Idempotens (B-09): hvert lokale får én række i dalux_sync_items med nøglen
// room:<roomId>. En gen-synk opdaterer rækken og ressourcen; den opretter ikke
// igen. Et lokale, der allerede findes som ressource under samme navn, ADOPTERES
// (får dalux_room_id) frem for at blive fordoblet — kunden har typisk oprettet
// sine lokaler i hånden, før integrationen kom til.
//
// Det, der IKKE gøres endnu: aktiver, og alt udgående (bookinger, fakturaer).
// De venter på kundens valg af Dalux-objekt (B-08) — se company_dalux_config.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { callerCanManageCompany } from '../_shared/user-admin.ts'
import { isServiceRole } from '../_shared/notify.ts'
import {
  DaluxError,
  listRooms,
  probe,
  roomName,
  udfNames,
  type DaluxEnv,
  type DaluxRoom,
} from '../_shared/dalux.ts'

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

type Action = 'save_key' | 'clear_key' | 'test' | 'run'
type Body = {
  companyId?: string
  action?: Action
  apiKey?: string
  expiresAt?: string
  trigger?: 'manual' | 'scheduled'
}

type Config = {
  company_id: string
  enabled: boolean
  environment: DaluxEnv
  api_key_set: boolean
  sync_rooms_in: boolean
  room_name_field: string | null
  verified_at: string | null
}

function reasonOf(e: unknown): string {
  if (e instanceof DaluxError) return e.code
  return 'internal'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const body = (await req.json().catch(() => ({}))) as Body
  const companyId = body.companyId?.trim()
  const action = body.action
  if (!companyId) return json({ error: 'company_required' }, 400)
  if (!action) return json({ error: 'action_required' }, 400)

  // Cron kalder med service-rollen og må kun køre 'run'. Alt andet kræver en
  // indlogget manager i virksomheden (eller platform-admin).
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '')
  let actor: string | null = null
  const scheduled = isServiceRole(token, serviceKey)
  if (scheduled) {
    if (action !== 'run') return json({ error: 'forbidden' }, 403)
  } else {
    const asCaller = createClient(url, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: userData, error: userErr } = await asCaller.auth.getUser()
    if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401)
    if (!(await callerCanManageCompany(admin, userData.user.id, companyId))) {
      return json({ error: 'forbidden' }, 403)
    }
    actor = userData.user.id
  }

  // Platformens hovedafbryder — undtagen clear_key: slår DCA integrationen
  // fra, skal kunden stadig kunne tilbagekalde sin nøgle.
  const { data: platform } = await admin.from('platform_settings').select('dalux_enabled').maybeSingle()
  if (!platform?.dalux_enabled && action !== 'clear_key') {
    return json({ error: 'integration_disabled' }, 403)
  }

  if (action === 'save_key' || action === 'clear_key') {
    const key = action === 'save_key' ? (body.apiKey ?? '').trim() : ''
    if (action === 'save_key' && !key) return json({ error: 'key_required' }, 400)
    if (key.length > 512 || /[\s]/.test(key)) return json({ error: 'key_invalid' }, 400)
    const { error: cfgError } = await admin
      .from('company_dalux_config')
      .upsert({ company_id: companyId }, { onConflict: 'company_id', ignoreDuplicates: true })
    if (cfgError) return json({ error: 'save_failed', detail: cfgError.message }, 500)
    const { error } = await admin
      .from('company_dalux_secret')
      .upsert({ company_id: companyId, api_key: key || null }, { onConflict: 'company_id' })
    if (error) return json({ error: 'save_failed', detail: error.message }, 500)
    // Udløbsdatoen er ikke hemmelig og må gerne stå i konfigurationen.
    if (action === 'save_key') {
      const expires = body.expiresAt && /^\d{4}-\d{2}-\d{2}$/.test(body.expiresAt) ? body.expiresAt : null
      await admin.from('company_dalux_config').update({ api_key_expires_at: expires }).eq('company_id', companyId)
    }
    return json({ ok: true, set: !!key })
  }

  const { data: cfg } = await admin
    .from('company_dalux_config')
    .select('company_id, enabled, environment, api_key_set, sync_rooms_in, room_name_field, verified_at')
    .eq('company_id', companyId)
    .maybeSingle<Config>()
  if (!cfg) return json({ error: 'not_configured' }, 400)
  if (!cfg.api_key_set) return json({ error: 'key_missing' }, 400)

  const { data: secret } = await admin
    .from('company_dalux_secret')
    .select('api_key')
    .eq('company_id', companyId)
    .maybeSingle<{ api_key: string | null }>()
  const apiKey = secret?.api_key
  if (!apiKey) return json({ error: 'key_missing' }, 400)

  if (action === 'test') {
    try {
      const p = await probe(cfg.environment, apiKey)
      // Feltnavnene hentes fra rummene — nok til at fylde vælgeren. Kan
      // rummene ikke læses (nøglen afgrænset til bygninger, rate limit …),
      // er nøglen stadig gyldig, men det SIGES i svaret i stedet for at
      // ligne "ingen felter".
      let fields: string[] = []
      let roomError: string | null = null
      try {
        fields = udfNames(await listRooms(cfg.environment, apiKey))
      } catch (e) {
        roomError = reasonOf(e)
      }
      await admin
        .from('company_dalux_config')
        .update({
          verified_at: new Date().toISOString(),
          verified_detail: { buildings: p.buildings, sample: p.sample, room_fields: fields, room_error: roomError },
        })
        .eq('company_id', companyId)
      await audit(admin, {
        p_company_id: companyId,
        p_action: 'dalux.verified',
        p_entity_type: 'company',
        p_entity_id: companyId,
        p_summary: null,
        p_detail: { environment: cfg.environment, buildings: p.buildings },
        p_actor: actor,
      })
      return json({ ok: true, buildings: p.buildings, sample: p.sample, roomFields: fields, roomError })
    } catch (e) {
      const reason = reasonOf(e)
      await audit(admin, {
        p_company_id: companyId,
        p_action: 'dalux.verify_failed',
        p_entity_type: 'company',
        p_entity_id: companyId,
        p_summary: null,
        p_detail: { environment: cfg.environment, reason },
        p_actor: actor,
      })
      return json({ ok: false, reason }, 200)
    }
  }

  // ---- run ----------------------------------------------------------------
  if (!cfg.enabled) return json({ error: 'not_enabled' }, 400)
  if (!cfg.verified_at) return json({ error: 'not_verified' }, 400)

  const trigger = scheduled ? 'scheduled' : 'manual'
  const { data: run, error: runErr } = await admin
    .from('dalux_sync_runs')
    .insert({ company_id: companyId, trigger, actor_user_id: actor })
    .select('id')
    .single<{ id: string }>()
  if (runErr || !run) return json({ error: 'run_failed', detail: runErr?.message }, 500)

  const counts: Record<string, Record<string, number>> = {}
  let fatal: string | null = null
  try {
    if (cfg.sync_rooms_in) {
      counts.rooms = await syncRooms(admin, cfg, apiKey, run.id)
    }
  } catch (e) {
    fatal = reasonOf(e)
  }

  const anyFailed = Object.values(counts).some((c) => (c.failed ?? 0) > 0)
  const status = fatal ? 'failed' : anyFailed ? 'partial' : 'ok'
  await admin
    .from('dalux_sync_runs')
    .update({ finished_at: new Date().toISOString(), status, counts, error: fatal })
    .eq('id', run.id)
  await admin
    .from('company_dalux_config')
    .update({ last_run_at: new Date().toISOString(), last_run_status: status, last_run_error: fatal })
    .eq('company_id', companyId)
  await audit(admin, {
    p_company_id: companyId,
    p_action: status === 'failed' ? 'dalux.sync_failed' : 'dalux.synced',
    p_entity_type: 'dalux_sync_run',
    p_entity_id: run.id,
    p_summary: null,
    p_detail: { trigger, status, counts, reason: fatal },
    p_actor: actor,
  })
  return json({ ok: status !== 'failed', status, counts, reason: fatal, runId: run.id })
})

// ---------------------------------------------------------------------------
// Lokaler → ressourcer
// ---------------------------------------------------------------------------
async function syncRooms(
  admin: SupabaseClient,
  cfg: Config,
  apiKey: string,
  runId: string,
): Promise<Record<string, number>> {
  const c = { seen: 0, created: 0, updated: 0, adopted: 0, unchanged: 0, skipped: 0, failed: 0 }
  const rooms = await listRooms(cfg.environment, apiKey)
  c.seen = rooms.length

  const { data: existing } = await admin
    .from('booking_resources')
    .select('id, name, dalux_room_id')
    .eq('company_id', cfg.company_id)
  const byRoomId = new Map<string, { id: string; name: string }>()
  const byName = new Map<string, { id: string; dalux_room_id: string | null }>()
  for (const r of existing ?? []) {
    if (r.dalux_room_id) byRoomId.set(r.dalux_room_id, { id: r.id, name: r.name })
    byName.set(r.name.trim().toLocaleLowerCase('da'), { id: r.id, dalux_room_id: r.dalux_room_id })
  }

  for (const room of rooms) {
    const roomId = room.roomId
    if (!roomId) continue
    const key = `room:${roomId}`
    const name = roomName(room, cfg.room_name_field)
    const base = {
      company_id: cfg.company_id,
      object_type: 'room',
      direction: 'in',
      external_id: roomId,
      idempotency_key: key,
      run_id: runId,
      last_attempt_at: new Date().toISOString(),
      payload: {
        floor_id: room.floorRef?.floorId ?? null,
        net_area: room.netArea ?? null,
        last_change: room.lastChangeDate ?? null,
      },
    }

    if (!name) {
      // Uden navn kan rummet ikke blive en ressource. Det er ikke en fejl i
      // Dalux — det er et felt, kunden ikke har udfyldt, og det skal stå i listen.
      c.skipped += 1
      await upsertItem(admin, { ...base, status: 'skipped', last_error: 'no_name', local_id: null })
      continue
    }

    try {
      const known = byRoomId.get(roomId)
      if (known) {
        if (known.name !== name) {
          const { error } = await admin
            .from('booking_resources')
            .update({ name })
            .eq('id', known.id)
          if (error) throw new Error(error.code === '23505' ? 'name_conflict' : 'update_failed')
          c.updated += 1
        } else {
          c.unchanged += 1
        }
        await upsertItem(admin, { ...base, status: 'done', last_error: null, local_id: known.id })
        continue
      }

      const sameName = byName.get(name.toLocaleLowerCase('da'))
      if (sameName && !sameName.dalux_room_id) {
        const { error } = await admin
          .from('booking_resources')
          .update({ dalux_room_id: roomId })
          .eq('id', sameName.id)
        if (error) throw new Error('adopt_failed')
        byRoomId.set(roomId, { id: sameName.id, name })
        // Navnet er nu taget af et Dalux-rum: et andet rum med samme navn må
        // ikke også adoptere den (det ville overskrive dalux_room_id).
        byName.set(name.toLocaleLowerCase('da'), { id: sameName.id, dalux_room_id: roomId })
        c.adopted += 1
        await upsertItem(admin, { ...base, status: 'done', last_error: null, local_id: sameName.id })
        continue
      }
      if (sameName && sameName.dalux_room_id && sameName.dalux_room_id !== roomId) {
        throw new Error('name_conflict')
      }

      const { data: created, error } = await admin
        .from('booking_resources')
        .insert({ company_id: cfg.company_id, name, dalux_room_id: roomId })
        .select('id')
        .single<{ id: string }>()
      if (error || !created) throw new Error(error?.code === '23505' ? 'name_conflict' : 'insert_failed')
      byRoomId.set(roomId, { id: created.id, name })
      byName.set(name.toLocaleLowerCase('da'), { id: created.id, dalux_room_id: roomId })
      c.created += 1
      await upsertItem(admin, { ...base, status: 'done', last_error: null, local_id: created.id })
    } catch (e) {
      c.failed += 1
      await upsertItem(admin, {
        ...base,
        status: 'failed',
        last_error: (e as Error).message || 'internal',
        local_id: null,
      })
    }
  }
  return c
}

/** Sporet må ikke fejle tavst: en manglende revisionslinje skal kunne findes i funktionsloggen. */
async function audit(admin: SupabaseClient, args: Record<string, unknown>) {
  const { error } = await admin.rpc('record_audit', args)
  if (error) console.error('record_audit fejlede:', error.message, args.p_action)
}

async function upsertItem(admin: SupabaseClient, row: Record<string, unknown>) {
  // attempts tælles op ved hver berøring; unique (company_id, idempotency_key)
  // gør upsert'en til en opdatering anden gang.
  const { data: prev } = await admin
    .from('dalux_sync_items')
    .select('attempts')
    .eq('company_id', row.company_id as string)
    .eq('idempotency_key', row.idempotency_key as string)
    .maybeSingle<{ attempts: number }>()
  await admin
    .from('dalux_sync_items')
    .upsert({ ...row, attempts: (prev?.attempts ?? 0) + 1 }, { onConflict: 'company_id,idempotency_key' })
}

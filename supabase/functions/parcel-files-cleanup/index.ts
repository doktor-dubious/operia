// parcel-files-cleanup — dagligt oprydningsjob for de to private filspande med
// persondata: 'parcel-photos' (tilstandsfotos + pakkedokumenter) og 'signatures'
// (underskrifter ved udlevering).
//
// To uafhængige regler:
//   Forældreløse  — filens pakke findes ikke længere (pakken eller hele
//                   virksomheden er slettet). Fjernes altid; filen kan ikke
//                   længere dokumentere noget.
//   For gamle     — ældre end platform_settings.parcel_files_retention_days.
//                   NULL (standard) = behold for altid, så adfærden er uændret
//                   indtil DCA aktivt sætter et vindue. Gælder KUN filer hvis
//                   pakke er lukket (udleveret/afvist/returneret): en åben
//                   eller omtvistet pakke beholder sin kædedokumentation
//                   uanset alder — vinduet må ikke kunne slette beviser for
//                   noget systemet stadig sporer.
//
// Derudover ryddes 'feedback'-spanden for skærmbilleder uden feedback-række
// (rækken slettet af en platform-admin, fx efter en sletteanmodning).
//
// Stinavne (sat af web + Android):
//   parcel-photos: <company>/<parcel>.jpg            (tilstandsfoto)
//                  <company>/<parcel>/<ts>.jpg       (pakkedokumenter)
//   signatures:    <company>/<parcel>.png            (web, overskrives)
//                  <company>/<parcel>-<ts>.png       (Android, én pr. forsøg)
// Fælles for dem alle: første UUID efter virksomhedsmappen er pakkens id.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { isServiceRole } from '../_shared/notify.ts'

const BUCKETS = ['parcel-photos', 'signatures']
const PAGE = 1000
// Loft pr. kørsel, så et enkelt job ikke kan løbe løbsk; resten tages i morgen.
const MAX_DELETES = 5000

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type Entry = { name: string; id: string | null; created_at?: string | null }

async function list(admin: SupabaseClient, bucket: string, path: string): Promise<Entry[]> {
  const out: Entry[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage.from(bucket).list(path, { limit: PAGE, offset })
    if (error) throw error
    out.push(...((data ?? []) as Entry[]))
    if ((data?.length ?? 0) < PAGE) return out
  }
}

// storage.list markerer mapper med id === null.
const isFolder = (e: Entry) => e.id === null

export type CleanupCounts = { scanned: number; orphans: number; expired: number; feedback: number }

// Slutstatusser — samme sæt som public.employee_has_open_parcels.
const CLOSED_STATUSES = new Set(['delivered', 'rejected', 'returned'])

async function cleanupBucket(
  admin: SupabaseClient,
  bucket: string,
  cutoff: Date | null,
  counts: CleanupCounts,
  doomed: string[],
) {
  for (const company of (await list(admin, bucket, '')).filter(isFolder)) {
    // Filer direkte i virksomhedsmappen + ét niveau ned (dokumentmapper).
    const level1 = await list(admin, bucket, company.name)
    const files: { path: string; created_at?: string | null }[] = []
    for (const entry of level1) {
      if (isFolder(entry)) {
        for (const deep of await list(admin, bucket, `${company.name}/${entry.name}`)) {
          if (!isFolder(deep)) {
            files.push({ path: `${company.name}/${entry.name}/${deep.name}`, created_at: deep.created_at })
          }
        }
      } else {
        files.push({ path: `${company.name}/${entry.name}`, created_at: entry.created_at })
      }
    }
    if (!files.length) continue
    counts.scanned += files.length

    // Hvilke pakke-id'er i denne mappe findes stadig — og hvilke er lukkede?
    const wanted = new Map<string, string[]>() // parcel_id -> stier
    const idByPath = new Map<string, string>() // sti -> parcel_id
    for (const f of files) {
      const hit = f.path.slice(company.name.length + 1).match(UUID)
      if (!hit) continue
      const id = hit[0].toLowerCase()
      idByPath.set(f.path, id)
      const list = wanted.get(id)
      if (list) list.push(f.path)
      else wanted.set(id, [f.path])
    }
    const ids = [...wanted.keys()]
    const alive = new Set<string>()
    const open = new Set<string>()
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await admin
        .from('parcels')
        .select('id, status')
        .in('id', ids.slice(i, i + 200))
      if (error) throw error
      for (const row of data ?? []) {
        const id = String(row.id).toLowerCase()
        alive.add(id)
        if (!CLOSED_STATUSES.has(String(row.status))) open.add(id)
      }
    }

    for (const [id, paths] of wanted) {
      if (!alive.has(id)) {
        for (const p of paths) {
          if (doomed.length >= MAX_DELETES) return
          doomed.push(`${bucket}:${p}`)
          counts.orphans++
        }
      }
    }
    if (!cutoff) continue
    const orphaned = new Set(doomed.map((d) => d.slice(bucket.length + 1)))
    for (const f of files) {
      if (orphaned.has(f.path)) continue // tælles allerede som forældreløs
      // Åben pakke ⇒ dokumentationen er stadig i brug — vinduet gælder ikke.
      const id = idByPath.get(f.path)
      if (id && open.has(id)) continue
      if (!f.created_at) continue
      if (new Date(f.created_at) >= cutoff) continue
      if (doomed.length >= MAX_DELETES) return
      doomed.push(`${bucket}:${f.path}`)
      counts.expired++
    }
  }
}

// 'feedback'-spanden (<user_id>/<tid>.<ext>): én regel — filen skal høre til en
// eksisterende feedback-række. Sletter en platform-admin rækken, rydder jobbet
// filen næste nat. Ny-uploadede filer får et døgns frist, fordi filen uploades
// FØR rækken indsættes — ellers kunne jobbet nå at slette et skærmbillede der
// var på vej ind.
async function cleanupFeedback(admin: SupabaseClient, counts: CleanupCounts, doomed: string[]) {
  const grace = new Date(Date.now() - 86_400_000)
  for (const folder of (await list(admin, 'feedback', '')).filter(isFolder)) {
    const files = (await list(admin, 'feedback', folder.name))
      .filter((e) => !isFolder(e))
      .map((e) => ({ path: `${folder.name}/${e.name}`, created_at: e.created_at }))
    if (!files.length) continue
    counts.scanned += files.length

    const referenced = new Set<string>()
    const paths = files.map((f) => f.path)
    for (let i = 0; i < paths.length; i += 200) {
      const { data, error } = await admin
        .from('feedback')
        .select('screenshot_path')
        .in('screenshot_path', paths.slice(i, i + 200))
      if (error) throw error
      for (const row of data ?? []) referenced.add(String(row.screenshot_path))
    }

    for (const f of files) {
      if (referenced.has(f.path)) continue
      if (f.created_at && new Date(f.created_at) >= grace) continue
      if (doomed.length >= MAX_DELETES) return
      doomed.push(`feedback:${f.path}`)
      counts.feedback++
    }
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '')
  if (!isServiceRole(token, serviceKey)) return json({ error: 'unauthorized' }, 401)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: settings } = await admin
    .from('platform_settings')
    .select('parcel_files_retention_days')
    .maybeSingle()
  const days = settings?.parcel_files_retention_days ?? null
  const cutoff = days ? new Date(Date.now() - days * 86_400_000) : null

  const counts: CleanupCounts = { scanned: 0, orphans: 0, expired: 0, feedback: 0 }
  const doomed: string[] = []
  try {
    for (const bucket of BUCKETS) await cleanupBucket(admin, bucket, cutoff, counts, doomed)
    await cleanupFeedback(admin, counts, doomed)
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
  }

  // Grupper efter spand og slet.
  let removed = 0
  for (const bucket of [...BUCKETS, 'feedback']) {
    const paths = doomed.filter((d) => d.startsWith(`${bucket}:`)).map((d) => d.slice(bucket.length + 1))
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100))
      if (error) return json({ ok: false, error: error.message, removed }, 500)
      removed += Math.min(100, paths.length - i)
    }
  }

  // Kun logværdigt når der faktisk blev slettet — ellers ville et dagligt job
  // fylde revisionsloggen med "ingenting sket".
  if (removed > 0) {
    await admin.rpc('record_audit', {
      p_company_id: null,
      p_action: 'retention.files_purged',
      p_entity_type: 'storage',
      p_entity_id: 'parcel-files',
      p_summary: null,
      p_detail: {
        removed, orphans: counts.orphans, expired: counts.expired,
        feedback: counts.feedback, scanned: counts.scanned,
      },
      p_actor: null,
    })
  }

  return json({ ok: true, ...counts, removed })
})

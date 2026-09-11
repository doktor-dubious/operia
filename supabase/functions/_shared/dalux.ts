// Dalux FM's REST-API (fm-api.dalux.com; spec v2.5.0 på SwaggerHub).
//
// Det, der er værd at vide om API'et, og som styrer koden her:
//   • Én header, `X-API-KEY`, udstedt af kundens Dalux-admin som en
//     API-identitet med udløb (B-06). Ingen OAuth, ingen refresh.
//   • Listekald pagineres med `bookmark`/`limit` (maks. 100) og et
//     `nextPage`-link i svaret. Linkene er "volatile" — de følges straks og
//     gemmes aldrig.
//   • Et Room har intet navnefelt. Navnet ligger i kundens egne
//     userDefinedFields, og hvilket felt det er, må konfigureres.
//   • Rate limit svarer med errorCode E42901.
//
// Fejl kastes som DaluxError med en kort maskinkode, så kalderen kan skrive
// den i udboksen og skærmen kan oversætte den — aldrig Dalux' rå svar.

export type DaluxEnv = 'production' | 'stage'

const REAL_BASE: Record<DaluxEnv, string> = {
  production: 'https://fm-api.dalux.com/api',
  stage: 'https://api.fm-stage.dalux.com/api',
}

// KUN til lokal test: peger begge miljøer på en attrap (supabase functions
// serve med DALUX_API_BASE=http://host.docker.internal:8787). Sættes aldrig på
// det hostede projekt — en nøgle til rigtige data må ikke kunne sendes til en
// vilkårlig host via en miljøvariabel.
const OVERRIDE = Deno.env.get('DALUX_API_BASE')?.replace(/\/$/, '')

export const DALUX_BASE: Record<DaluxEnv, string> = {
  production: OVERRIDE ?? REAL_BASE.production,
  stage: OVERRIDE ?? REAL_BASE.stage,
}

export class DaluxError extends Error {
  constructor(
    public code:
      | 'unauthorized'
      | 'forbidden'
      | 'rate_limited'
      | 'not_found'
      | 'bad_request'
      | 'upstream'
      | 'network',
    public status: number,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code)
  }
}

type Link = { rel?: string; href?: string; method?: string }

export type UdfValue = {
  text?: string | null
  date?: string | null
  number?: number | null
  integer?: number | null
  boolean?: boolean | null
}
export type Udf = { userDefinedFieldId?: string; name?: string; values?: UdfValue[] }

export type DaluxRoom = {
  roomId?: string
  floorRef?: { floorId?: string }
  calculatedGrossArea?: number | null
  netArea?: number | null
  lastChangeDate?: string | null
  userDefinedFields?: { items?: Udf[] }
}

export type DaluxBuilding = { buildingId?: string; name?: string }

const PAGE = 100
/** Loft, så en fejlkonfigureret nøgle til en kæmpe portefølje ikke løber løbsk. */
const MAX_ITEMS = 5000

async function call<T>(env: DaluxEnv, apiKey: string, url: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      headers: { 'X-API-KEY': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) {
    throw new DaluxError('network', 0, (e as Error).message)
  }
  if (res.ok) return (await res.json()) as T
  const text = await res.text().catch(() => '')
  let code: string | undefined
  try {
    code = (JSON.parse(text) as { errorCode?: string }).errorCode
  } catch {
    /* ikke JSON */
  }
  if (res.status === 401) throw new DaluxError('unauthorized', 401)
  if (res.status === 403) throw new DaluxError('forbidden', 403)
  if (res.status === 404) throw new DaluxError('not_found', 404)
  if (res.status === 429 || code === 'E42901') throw new DaluxError('rate_limited', 429)
  if (res.status >= 400 && res.status < 500) throw new DaluxError('bad_request', res.status, code)
  throw new DaluxError('upstream', res.status, code)
}

type ListResponse<T> = { items?: { data?: T; links?: Link[] }[]; links?: Link[] }

/** Alle sider af en liste, ved at følge nextPage-linket. */
async function listAll<T>(env: DaluxEnv, apiKey: string, path: string): Promise<T[]> {
  const out: T[] = []
  let url: string | null = `${DALUX_BASE[env]}${path}${path.includes('?') ? '&' : '?'}limit=${PAGE}`
  while (url && out.length < MAX_ITEMS) {
    const page: ListResponse<T> = await call<ListResponse<T>>(env, apiKey, url)
    for (const it of page.items ?? []) if (it.data) out.push(it.data)
    const next = (page.links ?? []).find((l) => l.rel === 'nextPage')?.href
    // Et relativt link gøres absolut; et fremmed host følges ikke.
    url = next ? new URL(next, DALUX_BASE[env]).toString() : null
    if (url && !url.startsWith(DALUX_BASE[env])) url = null
  }
  return out
}

/** Forbindelsestest: det billigste kald, der kræver en gyldig nøgle. */
export async function probe(env: DaluxEnv, apiKey: string): Promise<{ buildings: number; sample: string | null }> {
  const page = await call<ListResponse<DaluxBuilding>>(env, apiKey, `${DALUX_BASE[env]}/2.0/buildings?limit=5`)
  const items = (page.items ?? []).map((i) => i.data).filter(Boolean) as DaluxBuilding[]
  return { buildings: items.length, sample: items[0]?.name ?? null }
}

export function listRooms(env: DaluxEnv, apiKey: string): Promise<DaluxRoom[]> {
  return listAll<DaluxRoom>(env, apiKey, '/2.0/rooms')
}

/** Navnene på de brugerdefinerede felter, der optræder på rummene — til vælgeren. */
export function udfNames(rooms: DaluxRoom[]): string[] {
  const names = new Set<string>()
  for (const r of rooms) for (const f of r.userDefinedFields?.items ?? []) if (f.name) names.add(f.name)
  return [...names].sort((a, b) => a.localeCompare(b, 'da'))
}

/** Rummets navn efter kundens valgte felt; null når feltet ikke er sat på rummet. */
export function roomName(room: DaluxRoom, field: string | null): string | null {
  if (!field) return null
  const f = (room.userDefinedFields?.items ?? []).find((u) => u.name === field)
  const v = f?.values?.[0]
  if (!v) return null
  const s = v.text ?? (v.number ?? v.integer)?.toString() ?? null
  return s && s.trim() ? s.trim() : null
}

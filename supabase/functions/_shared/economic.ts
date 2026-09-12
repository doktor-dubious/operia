// Visma e-conomic REST API — det lille klientlag edge-funktionerne deler.
//
// Autentifikation er to headere: X-AppSecretToken (DCA's app, én pr.
// platform, fra platform_secrets) og X-AgreementGrantToken (kundens
// tilladelse, fra company_accounting_secret). Begge læses kun serverside.
//
// economicFetch er det ene kald, alt går igennem (headere, timeout). Ovenpå:
// /self (verifikation), opslag af bogførte fakturaer på vores kladdenummer
// (én kladde, eller mange på én gang til den planlagte kørsel) og de små
// hjælpere, funktionerne ellers hver havde en kopi af.

export const ECONOMIC_BASE = 'https://restapi.e-conomic.com'

export type EconomicCreds = { appSecretToken: string; agreementGrantToken: string }

export type EconomicError = {
  // e-conomics egen fejlkode (fx E02250 = tokenet svarer ikke til en gyldig
  // grant), når svaret var JSON. Vises aldrig råt for kunden — oversættes i
  // UI'et ud fra `reason`.
  errorCode?: string
  message?: string
  status: number
}

export class EconomicApiError extends Error {
  constructor(public readonly detail: EconomicError) {
    super(detail.message ?? `e-conomic svarede ${detail.status}`)
  }
}

const TIMEOUT_MS = 15_000

export async function economicFetch(
  creds: EconomicCreds,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(`${ECONOMIC_BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'X-AppSecretToken': creds.appSecretToken,
        'X-AgreementGrantToken': creds.agreementGrantToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
    })
  } finally {
    clearTimeout(timer)
  }
}

export type EconomicSelf = {
  agreementNumber: number
  companyName: string | null
  baseCurrency: string | null
}

/** GET /self — hvem er vi logget ind som? Kaster EconomicApiError ved afvisning. */
export async function economicSelf(creds: EconomicCreds): Promise<EconomicSelf> {
  const res = await economicFetch(creds, '/self')
  if (!res.ok) {
    let body: { errorCode?: string; message?: string } = {}
    try {
      body = await res.json()
    } catch {
      // ikke-JSON-svar (fx 502 fra en proxy) — status er nok
    }
    throw new EconomicApiError({ status: res.status, errorCode: body.errorCode, message: body.message })
  }
  const data = (await res.json()) as {
    agreementNumber?: number
    company?: { name?: string }
    settings?: { baseCurrency?: string }
  }
  if (typeof data.agreementNumber !== 'number') {
    throw new EconomicApiError({ status: res.status, message: 'uventet svar fra /self' })
  }
  return {
    agreementNumber: data.agreementNumber,
    companyName: data.company?.name ?? null,
    baseCurrency: data.settings?.baseCurrency ?? null,
  }
}

/**
 * Fejlårsag til klienten (i18n-nøgle companyAccounting.test_<reason>). 401 er
 * "et af tokens er forkert" — e-conomic skelner ikke i statuskoden mellem app-
 * og grant-token, men fejlkoden E02250 peger på grant-tokenet.
 */
export function economicReason(e: unknown): string {
  if (e instanceof EconomicApiError) {
    if (e.detail.status === 401) return e.detail.errorCode === 'E02250' ? 'invalid_grant' : 'auth_failed'
    if (e.detail.status === 403) return 'forbidden'
    if (e.detail.status === 429) return 'rate_limited'
    return 'api_error'
  }
  if (e instanceof DOMException && e.name === 'AbortError') return 'timeout'
  return 'network'
}

/**
 * e-conomics kladde-/fakturanummer som tekst — eller null. Et tomt eller
 * ulæseligt svar giver {}, og String(undefined) er 'undefined', som basens
 * not-null-tjek ville tage for et rigtigt nummer.
 */
export function numberOf(v: unknown): string | null {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return String(v)
  if (typeof v === 'string' && /^\d+$/.test(v)) return v
  return null
}

/**
 * Kundens e-conomic-adgang: DCA's app-hemmelighed (platform_secrets) og
 * kundens AgreementGrantToken (company_accounting_secret). Kun for
 * service-rollen; null, når en af dem mangler.
 */
export async function loadEconomicCreds(
  // deno-lint-ignore no-explicit-any
  admin: { from: (t: string) => any },
  appSecret: string | null,
  companyId: string,
): Promise<EconomicCreds | null> {
  const { data: sec } = await admin.from('company_accounting_secret')
    .select('access_token').eq('company_id', companyId).maybeSingle()
  const token = (sec as { access_token: string | null } | null)?.access_token
  if (!appSecret || !token) return null
  return { appSecretToken: appSecret, agreementGrantToken: token }
}

type Booked = { bookedInvoiceNumber?: unknown; references?: { other?: unknown } }
type BookedPage = { collection?: Booked[]; pagination?: { nextPage?: string } }

/** Én side bogførte fakturaer → (reference → fakturanummer-felt) for de søgte. */
function collect(page: BookedPage, wanted: Set<string>, into: Map<string, unknown>) {
  for (const b of page.collection ?? []) {
    const ref = String(b.references?.other ?? '')
    if (ref && wanted.has(ref) && !into.has(ref)) into.set(ref, b.bookedInvoiceNumber)
  }
}

export type BookedLookup =
  | { ok: true; found: Map<string, string | null>; complete: boolean }
  | { ok: false; res: Response }

/**
 * Slå MANGE kladdenumre op i e-conomics bogførte fakturaer på én gang: de
 * bogførte fakturaer fra overførselsdatoen og frem hentes én gang (op til
 * maxPages sider à 1000), og referencerne sammenlignes her — filtrering på
 * indlejrede felter er ikke lovet for alle felter. Fundne kladder får
 * fakturanummeret (null = fundet, men nummeret kunne ikke læses — det er IKKE
 * "ikke bogført"). `complete` = alle sider blev læst; ellers kan en manglende
 * kladde stadig være bogført, og kalderen må spørge direkte på den.
 */
export async function findBookedByReferences(
  creds: EconomicCreds,
  references: Iterable<string>,
  since: string | null,
  maxPages = 5,
): Promise<BookedLookup> {
  const wanted = new Set(references)
  const raw = new Map<string, unknown>()
  const from = since ? new Date(Date.parse(since) - 86_400_000).toISOString().slice(0, 10) : null
  let path: string | null = `/invoices/booked?pagesize=1000&sort=-bookedInvoiceNumber${from ? `&filter=date$gte:${from}` : ''}`
  let complete = false
  for (let page = 0; path; page++) {
    if (page >= maxPages) break
    const res: Response = await economicFetch(creds, path)
    if (!res.ok) return { ok: false, res }
    const body = (await res.json().catch(() => ({}))) as BookedPage
    collect(body, wanted, raw)
    if (raw.size === wanted.size) { complete = true; break }
    const next = body.pagination?.nextPage
    path = next ? next.replace(ECONOMIC_BASE, '') : null
    if (!path) complete = true
  }
  const found = new Map<string, string | null>()
  for (const [ref, v] of raw) found.set(ref, numberOf(v))
  return { ok: true, found, complete }
}

/**
 * Find den bogførte faktura, der kom af ÉN kladde: den bærer vores
 * kladdenummer i e-conomics "anden reference" (references.other). Først det
 * direkte filter (ét billigt kald); svarer det tomt, gennemgås de bogførte
 * fakturaer fra overførselsdatoen og frem (højst tre sider à 1000) — et tomt
 * filtersvar må ikke betyde "ikke bogført", når den er det.
 * matched = fakturaen findes; invoiceNo null med matched = nummeret kunne
 * ikke læses ud af svaret.
 */
export async function findBookedByReference(
  creds: EconomicCreds,
  reference: string,
  since: string | null,
): Promise<{ ok: true; invoiceNo: string | null; matched: boolean } | { ok: false; res: Response }> {
  const direct = await economicFetch(creds, `/invoices/booked?pagesize=5&filter=references.other$eq:${encodeURIComponent(reference)}`)
  if (!direct.ok) return { ok: false, res: direct }
  const hit = new Map<string, unknown>()
  collect((await direct.json().catch(() => ({}))) as BookedPage, new Set([reference]), hit)
  if (hit.has(reference)) return { ok: true, invoiceNo: numberOf(hit.get(reference)), matched: true }

  const scan = await findBookedByReferences(creds, [reference], since, 3)
  if (!scan.ok) return scan
  if (scan.found.has(reference)) return { ok: true, invoiceNo: scan.found.get(reference) ?? null, matched: true }
  return { ok: true, invoiceNo: null, matched: false }
}

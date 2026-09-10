// Visma e-conomic REST API — det lille klientlag edge-funktionerne deler.
//
// Autentifikation er to headere: X-AppSecretToken (DCA's app, én pr.
// platform, fra platform_secrets) og X-AgreementGrantToken (kundens
// tilladelse, fra company_accounting_secret). Begge læses kun serverside.
//
// I dette trin bruges kun GET /self (hvilket regnskab giver tokenet adgang
// til?). Fakturakladder m.v. kommer i de næste trin og bygger ovenpå
// economicFetch.

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

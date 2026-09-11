// economic-transfer — fakturakladde → e-conomic (EVU-krav C-02), og
// fakturanummeret tilbage igen.
//
// Handlinger (kalderen skal have økonomirollen; genverificeres af RPC'erne):
//   transfer  → opretter en fakturakladde i e-conomic ud fra Operias kladde og
//               kalder transfer_invoice_draft med e-conomics kladdenummer. Med
//               automatisk bogføring bogføres den straks, og fakturanummeret
//               skrives tilbage med det samme.
//   sync      → slår en overført kladde op i e-conomics bogførte fakturaer
//               (på vores kladdenummer i referencefeltet) og skriver
//               fakturanummeret tilbage, når bogholderen har bogført.
//   customers → debitorliste til vælgeren i opsætningen (GET, ingen skrivning).
//   products  → produktliste til vælgeren.
//
// Kaldene ind i Operias base sker med KALDERENS JWT (ikke service-rollen), så
// rettigheder, statusværn og revisionsspor er de samme som ved et klik.
// Kun e-conomics hemmeligheder læses med service-rollen.
//
// Idempotens mod e-conomic: Idempotency-Key = kladdens id, så et netværksudfald
// midt i en overførsel ikke giver to kladder derovre.
//
// Rækkefølgen er bevidst: e-conomic-kladden oprettes, Operia noterer
// overførslen, og FØRST DEREFTER bogføres der. Bogføring kan ikke fortrydes;
// fejler Operias notering, findes der kun en kladde derovre, som næste forsøg
// finder på referencen — aldrig en bogført faktura, ingen ved af.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { platformSecret } from '../_shared/platform-secret.ts'
import { EconomicApiError, economicFetch, economicReason, type EconomicCreds } from '../_shared/economic.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

type Action = 'transfer' | 'sync' | 'customers' | 'products'
type Body = { companyId?: string; action?: Action; draftId?: string; query?: string }

type Config = {
  enabled: boolean
  provider: string
  verified_at: string | null
  economic_customer_number: number | null
  economic_product_room: string | null
  economic_product_participants: string | null
  economic_product_service: string | null
  economic_auto_book: boolean
}
type Draft = {
  id: string; company_id: string; number: string; kind: string; status: string; currency: string
  bill_to_ref: string | null; period_from: string | null; period_to: string | null; note: string | null
  external_system: string | null; external_id: string | null; invoice_no: string | null
  stale_at: string | null
}
type Line = {
  source: string; description: string; quantity: number; unit_price: number; sort_order: number
  booking: { ends_at: string } | null
}

/**
 * e-conomics kladde-/fakturanummer som tekst — eller null. readJson giver {}
 * på et tomt eller ulæseligt 2xx-svar, og String(undefined) er 'undefined',
 * som basens not-null-tjek ville tage for et rigtigt nummer.
 */
function numberOf(v: unknown): string | null {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return String(v)
  if (typeof v === 'string' && /^\d+$/.test(v)) return v
  return null
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try { return (await res.json()) as Record<string, unknown> } catch { return {} }
}

/** e-conomics fejlsvar → den korte maskinkode, skærmen oversætter. */
function reasonOf(res: Response, body: Record<string, unknown>): string {
  return economicReason(new EconomicApiError({
    status: res.status,
    errorCode: typeof body.errorCode === 'string' ? body.errorCode : undefined,
    message: typeof body.message === 'string' ? body.message : undefined,
  }))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authHeader = req.headers.get('Authorization') ?? ''
  const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: u, error: uErr } = await asCaller.auth.getUser()
  if (uErr || !u.user) return json({ error: 'unauthorized' }, 401)

  const body = (await req.json().catch(() => ({}))) as Body
  const companyId = body.companyId?.trim()
  if (!companyId || !body.action) return json({ error: 'company_and_action_required' }, 400)

  // Rettighed: økonomirollen, afgjort af basen (samme funktion som RPC'erne).
  const { data: allowed } = await asCaller.rpc('can_invoice_bookings', { p_company_id: companyId })
  if (!allowed) return json({ error: 'forbidden' }, 403)

  const { data: cfg } = await admin.from('company_accounting_config').select('*').eq('company_id', companyId).maybeSingle<Config>()
  if (!cfg?.enabled || cfg.provider !== 'economic') return json({ error: 'not_configured' }, 400)
  if (!cfg.verified_at) return json({ error: 'not_verified' }, 400)

  const appSecret = await platformSecret(admin, 'economic_app_secret_token')
  const { data: sec } = await admin.from('company_accounting_secret').select('access_token').eq('company_id', companyId).maybeSingle<{ access_token: string | null }>()
  if (!appSecret || !sec?.access_token) return json({ error: 'token_missing' }, 400)
  const creds: EconomicCreds = { appSecretToken: appSecret, agreementGrantToken: sec.access_token }

  try {
    if (body.action === 'customers' || body.action === 'products') {
      const q = (body.query ?? '').trim().replace(/[$*(),\[\]]/g, '')
      const path = body.action === 'customers'
        ? `/customers?pagesize=50&sort=name${q ? `&filter=name$like:${encodeURIComponent(q)}` : ''}`
        : `/products?pagesize=50&sort=name${q ? `&filter=name$like:${encodeURIComponent(q)}` : ''}`
      const res = await economicFetch(creds, path)
      if (!res.ok) return json({ ok: false, reason: reasonOf(res, await readJson(res)) }, 200)
      const d = await readJson(res)
      const items = ((d.collection as Record<string, unknown>[]) ?? []).map((x) =>
        body.action === 'customers'
          ? { number: x.customerNumber, name: x.name }
          : { number: x.productNumber, name: x.name, price: x.salesPrice ?? null },
      )
      return json({ ok: true, items })
    }

    if (!body.draftId) return json({ error: 'draft_required' }, 400)
    // Kladden læses som kalderen: RLS afgør om den må ses.
    const { data: draft } = await asCaller.from('invoice_drafts').select('*').eq('id', body.draftId).maybeSingle<Draft>()
    if (!draft || draft.company_id !== companyId) return json({ error: 'draft_not_found' }, 404)

    if (body.action === 'sync') {
      if (draft.status !== 'transferred' || draft.external_system !== 'economic') return json({ error: 'not_transferred_to_economic' }, 400)
      if (draft.invoice_no) return json({ ok: true, invoiceNo: draft.invoice_no, already: true })
      const res = await economicFetch(creds, `/invoices/booked?pagesize=5&filter=references.other$eq:${encodeURIComponent(draft.number)}`)
      if (!res.ok) return json({ ok: false, reason: reasonOf(res, await readJson(res)) })
      const d = await readJson(res)
      const hit = ((d.collection as Record<string, unknown>[]) ?? [])[0]
      if (!hit) return json({ ok: true, invoiceNo: null, booked: false })
      const no = numberOf(hit.bookedInvoiceNumber)
      if (!no) return json({ ok: false, reason: 'api_error', step: 'sync' })
      const { error } = await asCaller.rpc('record_invoice_booked', { p_draft_id: draft.id, p_invoice_no: no })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true, invoiceNo: no, booked: true })
    }

    // ---- transfer -----------------------------------------------------------
    if (draft.status !== 'approved') return json({ error: 'draft_not_approved' }, 400)
    // Samme værn som transfer_invoice_draft — men FØR der oprettes noget hos
    // e-conomic, så en afvisning ikke efterlader en forældreløs kladde derovre.
    if (draft.stale_at) return json({ error: 'draft_stale' }, 400)
    const customerNo = /^\d+$/.test(draft.bill_to_ref ?? '') ? Number(draft.bill_to_ref) : cfg.economic_customer_number
    if (!customerNo) return json({ error: 'customer_missing' }, 400)
    const productFor = (source: string) =>
      source === 'resource' ? cfg.economic_product_room
        : source === 'participants' ? cfg.economic_product_participants
        : cfg.economic_product_service
    const { data: lines } = await asCaller
      .from('invoice_draft_lines')
      .select('source, description, quantity, unit_price, sort_order, booking:bookings!invoice_draft_lines_booking_id_fkey (ends_at)')
      .eq('draft_id', draft.id)
      .order('sort_order')
    if (!lines || lines.length === 0) return json({ error: 'no_lines' }, 400)
    // Uden genererede typer gætter klienten, at en indlejret række er en liste;
    // booking_id er én FK, så det er én række (eller null for manuelle linjer).
    const rows = lines as unknown as Line[]
    // set_booking_invoiced afviser en booking, der ikke er afholdt
    // (booking_not_completed). Det skal siges her — ikke efter e-conomic-kaldet.
    const nowMs = Date.now()
    if (rows.some((l) => l.booking?.ends_at && Date.parse(l.booking.ends_at) > nowMs)) {
      return json({ error: 'booking_not_completed' }, 400)
    }
    const missing = rows.find((l) => !productFor(l.source))
    if (missing) return json({ error: 'product_missing', source: missing.source }, 400)

    // Findes kladden allerede i e-conomic (en tidligere overførsel, der
    // fejlede EFTER oprettelsen), genbruges den. e-conomics Idempotency-Key
    // dækker kun én time; referencefeltet dækker for altid.
    let draftNo: string | null = null
    const existingRes = await economicFetch(creds, `/invoices/drafts?pagesize=5&filter=references.other$eq:${encodeURIComponent(draft.number)}`)
    if (existingRes.ok) {
      const ex = await readJson(existingRes)
      const hit = ((ex.collection as Record<string, unknown>[]) ?? [])[0]
      draftNo = numberOf(hit?.draftInvoiceNumber)
    }

    // Kundens skabelon: layout, betalingsbetingelser, momszone, adresse — det
    // e-conomic selv ville fylde ud, hvis bogholderen oprettede kladden.
    const tplRes = draftNo ? null : await economicFetch(creds, `/customers/${customerNo}/templates/invoice`)
    if (tplRes && !tplRes.ok) return json({ ok: false, reason: reasonOf(tplRes, await readJson(tplRes)), step: 'template' })
    const tpl = tplRes ? await readJson(tplRes) : {}
    const payload = {
      date: new Date().toISOString().slice(0, 10),
      currency: draft.currency || (tpl.currency as string) || 'DKK',
      customer: tpl.customer,
      recipient: tpl.recipient,
      layout: tpl.layout,
      paymentTerms: tpl.paymentTerms,
      references: { other: draft.number },
      notes: {
        heading: draft.kind === 'credit' ? `Kreditnota ${draft.number}` : `Operia ${draft.number}`,
        textLine1: draft.period_from ? `Periode ${draft.period_from} – ${draft.period_to}` : undefined,
        textLine2: draft.note ?? undefined,
      },
      lines: rows.map((l, i) => ({
        lineNumber: i + 1,
        product: { productNumber: productFor(l.source) },
        description: l.description.slice(0, 2500),
        quantity: Number(l.quantity),
        unitNetPrice: Number(l.unit_price),
      })),
    }
    if (!draftNo) {
      const createRes = await economicFetch(creds, '/invoices/drafts', {
        method: 'POST',
        headers: { 'Idempotency-Key': draft.id },
        body: JSON.stringify(payload),
      })
      const created = await readJson(createRes)
      if (!createRes.ok) return json({ ok: false, reason: reasonOf(createRes, created), step: 'create', detail: String(created.message ?? '').slice(0, 300) })
      draftNo = numberOf(created.draftInvoiceNumber)
      // 2xx uden et kladdenummer (tomt eller afbrudt svar): intet er noteret,
      // og næste forsøg finder kladden på referencen, hvis den blev oprettet.
      if (!draftNo) return json({ ok: false, reason: 'api_error', step: 'create' })
    }

    // Operias notering FØR bogføringen. p_invoice_no har ingen default i
    // basen: sendes den som undefined, udelades den af JSON, og PostgREST
    // finder ingen funktion med den signatur. null er en værdi; undefined er
    // fravær — og null er tilladt, når kladden går til et regnskabssystem.
    const { error } = await asCaller.rpc('transfer_invoice_draft', {
      p_draft_id: draft.id,
      p_invoice_no: null,
      p_system: 'economic',
      p_external_id: draftNo,
    })
    if (error) return json({ error: error.message, draftNo }, 400)

    let invoiceNo: string | null = null
    let recorded = false
    if (cfg.economic_auto_book) {
      const bookRes = await economicFetch(creds, '/invoices/booked', {
        method: 'POST',
        headers: { 'Idempotency-Key': `${draft.id}:book` },
        body: JSON.stringify({ draftInvoice: { draftInvoiceNumber: Number(draftNo) } }),
      })
      const booked = await readJson(bookRes)
      if (bookRes.ok) invoiceNo = numberOf(booked.bookedInvoiceNumber)
      else console.warn('auto-book failed:', reasonOf(bookRes, booked))
      if (invoiceNo) {
        // Fejler noteringen af nummeret, er kladden stadig overført; 'sync'
        // henter nummeret på referencen, når som helst.
        const rec = await asCaller.rpc('record_invoice_booked', { p_draft_id: draft.id, p_invoice_no: invoiceNo })
        recorded = !rec.error
        if (rec.error) console.warn('record_invoice_booked failed:', rec.error.message)
      }
    }
    return json({ ok: true, draftNo, invoiceNo, booked: !!invoiceNo, recorded })
  } catch (e) {
    return json({ ok: false, reason: economicReason(e) }, 200)
  }
})

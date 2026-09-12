// economic-transfer — fakturakladde → e-conomic (EVU-krav C-02), og
// fakturanummeret tilbage igen.
//
// Handlinger:
//   transfer  → opretter en fakturakladde i e-conomic ud fra Operias kladde og
//               kalder transfer_invoice_draft med e-conomics kladdenummer. Med
//               automatisk bogføring bogføres den straks, og fakturanummeret
//               skrives tilbage med det samme. Kræver økonomirollen
//               (genverificeres af RPC'erne).
//   sync      → slår en overført kladde op i e-conomics bogførte fakturaer
//               (på vores kladdenummer i referencefeltet) og skriver
//               fakturanummeret tilbage, når bogholderen har bogført.
//               Kræver økonomirollen.
//   customers → debitorliste til vælgeren i opsætningen (GET, ingen skrivning).
//   products  → produktliste til vælgerne — med den momskode, e-conomic vil
//               bogføre produktet med (produkt → varegruppe → salgskonto for
//               debitorens momszone → kontoens momskode). Momsen sidder ikke
//               på produktet, så skærmen kan ikke vise den uden dette opslag.
//               Listerne må også hentes af den, der må redigere ydelser,
//               kategorier og niveauer (booking_manager): produktvælgeren
//               sidder på de skærme.
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
import {
  ECONOMIC_BASE, EconomicApiError, economicFetch, economicReason, findBookedByReference, loadEconomicCreds, numberOf,
  type EconomicCreds,
} from '../_shared/economic.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

type Action = 'transfer' | 'sync' | 'customers' | 'products'
type Body = { companyId?: string; action?: Action; draftId?: string; query?: string; ignoreVat?: boolean }

type Config = {
  enabled: boolean
  provider: string
  verified_at: string | null
  accounting_debtor_ref: string | null
  accounting_item_room: string | null
  accounting_item_participants: string | null
  accounting_item_service: string | null
  accounting_auto_book: boolean
}
type Draft = {
  id: string; company_id: string; number: string; kind: string; status: string; currency: string
  bill_to_ref: string | null; period_from: string | null; period_to: string | null; note: string | null
  external_system: string | null; external_id: string | null; invoice_no: string | null
  stale_at: string | null; transferred_at: string | null
}
type Line = {
  source: string; description: string; quantity: number; unit_price: number; sort_order: number
  ref_id: string | null
  vat_code: string | null
  booking: { ends_at: string; resource_id: string | null } | null
}
type Mismatch = { line: number; description: string; product: string; operia: string; economic: string }

// Listerne til vælgerne: e-conomic giver højst 1000 pr. side; flere sider
// følges, så et produkt nr. 51 (eller 1001) også kan vælges. Loftet er kun
// et værn mod et regnskab med titusinder af produkter.
const LIST_PAGE_SIZE = 1000
const LIST_MAX_PAGES = 5

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try { return (await res.json()) as Record<string, unknown> } catch { return {} }
}

/** Momskoder sammenlignes uden hensyn til store/små bogstaver og luft. */
const normVat = (v: string | null | undefined) => (v ?? '').trim().toUpperCase()

/**
 * Momskoden pr. varegruppe, som e-conomic vil bogføre den: varegruppens
 * salgskonto for debitorens momszone → kontoens momskode. '' = kontoen har
 * ingen momskode (momsfrit). Grupper, der ikke kan slås op, udelades — og
 * fejler hele opslaget, svares null: momsen er da "ukendt", og ingen linje
 * afvises på det. Opslaget er kun en hjælp; e-conomic bogfører uanset.
 */
async function vatByGroup(creds: EconomicCreds, customerNo: number | null, groupNos: number[]): Promise<Map<number, string> | null> {
  try {
    let zone = 1
    if (customerNo) {
      const c = await economicFetch(creds, `/customers/${customerNo}`)
      if (c.ok) {
        const z = ((await readJson(c)).vatZone as { vatZoneNumber?: number } | undefined)?.vatZoneNumber
        if (typeof z === 'number') zone = z
      }
    }
    const out = new Map<number, string>()
    await Promise.all([...new Set(groupNos)].map(async (g) => {
      const r = await economicFetch(creds, `/product-groups/${g}/sales-accounts`)
      if (!r.ok) return
      const accts = (((await readJson(r)).collection as {
        vatZone?: { vatZoneNumber?: number }
        salesAccount?: { vatAccount?: { vatCode?: string } }
      }[]) ?? [])
      const hit = accts.find((a) => a.vatZone?.vatZoneNumber === zone)
      if (hit) out.set(g, hit.salesAccount?.vatAccount?.vatCode ?? '')
    }))
    return out
  } catch (e) {
    console.warn('vat lookup failed:', economicReason(e))
    return null
  }
}

/**
 * Varegruppen pr. produkt. Samme regel som vatByGroup: et opslag, der fejler
 * (timeout, netværk), giver null og standser ikke overførslen — kontrollen er
 * en hjælp, ikke et værn, og skærmen kan kun sige "overfør alligevel" til en
 * momsafvigelse, ikke til en timeout.
 */
async function groupByProductNo(creds: EconomicCreds, productNos: string[]): Promise<Map<string, number> | null> {
  try {
    const out = new Map<string, number>()
    await Promise.all(productNos.map(async (no) => {
      const r = await economicFetch(creds, `/products/${encodeURIComponent(no)}`)
      if (!r.ok) return
      const g = ((await readJson(r)).productGroup as { productGroupNumber?: number } | undefined)?.productGroupNumber
      if (typeof g === 'number') out.set(no, g)
    }))
    return out
  } catch (e) {
    console.warn('product lookup failed:', economicReason(e))
    return null
  }
}

/** Alle rækker i en e-conomic-samling, side for side (op til LIST_MAX_PAGES). */
async function listAll(creds: EconomicCreds, firstPath: string): Promise<{ ok: true; rows: Record<string, unknown>[] } | { ok: false; res: Response }> {
  const rows: Record<string, unknown>[] = []
  let path: string | null = firstPath
  for (let page = 0; path && page < LIST_MAX_PAGES; page++) {
    const res: Response = await economicFetch(creds, path)
    if (!res.ok) return { ok: false, res }
    const d = await readJson(res)
    rows.push(...(((d.collection as Record<string, unknown>[]) ?? [])))
    const next = (d.pagination as { nextPage?: string } | undefined)?.nextPage
    path = next ? next.replace(ECONOMIC_BASE, '') : null
  }
  return { ok: true, rows }
}

/** Debitoren fra opsætningen som tal — e-conomics kundenummer er numerisk. */
const debtorNo = (ref: string | null | undefined): number | null =>
  ref && /^\d+$/.test(ref) ? Number(ref) : null

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
  const isList = body.action === 'customers' || body.action === 'products'

  // Rettighed, afgjort af basen (samme funktioner som RPC'erne): overførsel
  // og opslag af fakturanummer er økonomirollens; listerne må også den hente,
  // der må redigere ydelser/kategorier/niveauer, hvor vælgeren sidder.
  const { data: canInvoice } = await asCaller.rpc('can_invoice_bookings', { p_company_id: companyId })
  let allowed = !!canInvoice
  if (!allowed && isList) {
    const { data: canManage } = await asCaller.rpc('can_manage_bookings', { p_company_id: companyId })
    allowed = !!canManage
  }
  if (!allowed) return json({ error: 'forbidden' }, 403)

  const { data: cfg } = await admin.from('company_accounting_config').select('*').eq('company_id', companyId).maybeSingle<Config>()
  if (!cfg?.enabled || cfg.provider !== 'economic') return json({ error: 'not_configured' }, 400)
  if (!cfg.verified_at) return json({ error: 'not_verified' }, 400)

  const creds = await loadEconomicCreds(admin, await platformSecret(admin, 'economic_app_secret_token'), companyId)
  if (!creds) return json({ error: 'token_missing' }, 400)

  try {
    if (isList) {
      const q = (body.query ?? '').trim().replace(/[$*(),\[\]]/g, '')
      const filter = q ? `&filter=name$like:${encodeURIComponent(q)}` : ''
      const listed = await listAll(creds, `/${body.action}?pagesize=${LIST_PAGE_SIZE}&sort=name${filter}`)
      if (!listed.ok) return json({ ok: false, reason: reasonOf(listed.res, await readJson(listed.res)) }, 200)
      const rows = listed.rows
      if (body.action === 'customers') {
        return json({ ok: true, items: rows.map((x) => ({ number: x.customerNumber, name: x.name })) })
      }
      // Momskoden pr. produkt følger med, så vælgeren kan vise den og fylde
      // Operias momskode ud — og mapningens typeprodukter, så "standard" i
      // vælgeren kan sige, hvad den står for.
      const groupOf = (x: Record<string, unknown>) => (x.productGroup as { productGroupNumber?: number } | undefined)?.productGroupNumber
      const vat = await vatByGroup(creds, debtorNo(cfg.accounting_debtor_ref), rows.map(groupOf).filter((g): g is number => typeof g === 'number'))
      const items = rows.map((x) => {
        const g = groupOf(x)
        const code = vat && typeof g === 'number' ? vat.get(g) : undefined
        return { number: x.productNumber, name: x.name, price: x.salesPrice ?? null, vatCode: code === undefined ? null : code }
      })
      return json({
        ok: true,
        items,
        defaults: { room: cfg.accounting_item_room, participants: cfg.accounting_item_participants, service: cfg.accounting_item_service },
      })
    }

    if (!body.draftId) return json({ error: 'draft_required' }, 400)
    // Kladden læses som kalderen: RLS afgør om den må ses.
    const { data: draft } = await asCaller.from('invoice_drafts').select('*').eq('id', body.draftId).maybeSingle<Draft>()
    if (!draft || draft.company_id !== companyId) return json({ error: 'draft_not_found' }, 404)

    if (body.action === 'sync') {
      if (draft.status !== 'transferred' || draft.external_system !== 'economic') return json({ error: 'not_transferred_to_economic' }, 400)
      if (draft.invoice_no) return json({ ok: true, invoiceNo: draft.invoice_no, already: true })
      const found = await findBookedByReference(creds, draft.number, draft.transferred_at)
      if (!found.ok) return json({ ok: false, reason: reasonOf(found.res, await readJson(found.res)) })
      if (!found.matched) return json({ ok: true, invoiceNo: null, booked: false })
      // Fundet, men uden læseligt nummer: det er en fejl i svaret, ikke "ikke
      // bogført endnu" — sig det, så ingen venter forgæves på næste kørsel.
      if (!found.invoiceNo) return json({ ok: false, reason: 'invoice_number_unreadable' })
      const no = found.invoiceNo
      const { error } = await asCaller.rpc('record_invoice_booked', { p_draft_id: draft.id, p_invoice_no: no })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true, invoiceNo: no, booked: true })
    }

    // ---- transfer -----------------------------------------------------------
    if (draft.status !== 'approved') return json({ error: 'draft_not_approved' }, 400)
    // Samme værn som transfer_invoice_draft — men FØR der oprettes noget hos
    // e-conomic, så en afvisning ikke efterlader en forældreløs kladde derovre.
    if (draft.stale_at) return json({ error: 'draft_stale' }, 400)
    const customerNo = /^\d+$/.test(draft.bill_to_ref ?? '') ? Number(draft.bill_to_ref) : (cfg.accounting_debtor_ref && /^\d+$/.test(cfg.accounting_debtor_ref) ? Number(cfg.accounting_debtor_ref) : null)
    if (!customerNo) return json({ error: 'customer_missing' }, 400)
    const { data: lines } = await asCaller
      .from('invoice_draft_lines')
      .select('source, description, quantity, unit_price, sort_order, ref_id, vat_code, booking:bookings!invoice_draft_lines_booking_id_fkey (ends_at, resource_id)')
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
    // Produktet pr. linje: først det, der er sat på tingen selv (ydelse /
    // ressourcekategori / kursistniveau — samme sted som momskoden), ellers
    // typeproduktet fra mapningen. Slås op ved OVERFØRSLEN, så en rettet
    // mapning gælder for alt, der ikke er sendt endnu.
    //
    // Lokalelinjer: kategorien slås op gennem bookingens ressource NU — ikke
    // fra linjens ref_id, der er kategorien ved dannelsen. Flyttes ressourcen
    // til en anden kategori (fx for at rette produktet), skal det gælde, og
    // en slettet kategori er da blot "ingen kategori" → typeproduktet.
    const resourceIds = [...new Set(rows.map((l) => l.booking?.resource_id).filter((x): x is string => !!x))]
    const categoryOfResource = new Map<string, string | null>()
    if (resourceIds.length > 0) {
      const { data: res } = await asCaller.from('booking_resources').select('id, category_id').in('id', resourceIds)
      for (const r of (res ?? []) as { id: string; category_id: string | null }[]) categoryOfResource.set(r.id, r.category_id)
    }
    const itemKey = (l: Line): string | null =>
      l.source === 'resource'
        ? (l.booking?.resource_id ? categoryOfResource.get(l.booking.resource_id) ?? null : null)
        : l.ref_id
    const refs = [...new Set(rows.map(itemKey).filter((x): x is string => !!x))]
    const perItem = new Map<string, string>()
    if (refs.length > 0) {
      const [svc, cat, lvl] = await Promise.all([
        asCaller.from('booking_services').select('id, accounting_item_ref').in('id', refs),
        asCaller.from('booking_categories').select('id, accounting_item_ref').in('id', refs),
        asCaller.from('booking_participant_levels').select('id, accounting_item_ref').in('id', refs),
      ])
      for (const r of [...(svc.data ?? []), ...(cat.data ?? []), ...(lvl.data ?? [])] as { id: string; accounting_item_ref: string | null }[]) {
        if (r.accounting_item_ref) perItem.set(r.id, r.accounting_item_ref)
      }
    }
    const productFor = (l: Line) => {
      const k = itemKey(l)
      return (k && perItem.get(k)) ||
        (l.source === 'resource' ? cfg.accounting_item_room
          : l.source === 'participants' ? cfg.accounting_item_participants
          : cfg.accounting_item_service)
    }
    const missing = rows.find((l) => !productFor(l))
    if (missing) return json({ error: 'product_missing', source: missing.source }, 400)

    // Momskontrol FØR der oprettes noget: e-conomic bogfører efter produktet,
    // ikke efter Operias momskode. Siger linjen U25 og produktets salgskonto
    // noget andet, er enten produktet eller koden forkert — og det skal
    // bogholderen se nu, ikke i momsregnskabet. Kan overrules (ignoreVat),
    // for koden i Operia er dokumentation, produktet er sandheden — men da
    // køres kontrollen stadig, så det, der blev tilsidesat, kommer med i
    // revisionsrækken for overførslen.
    let mismatches: Mismatch[] = []
    let vatLookup: 'ok' | 'failed' | 'skipped' = 'skipped'
    if (rows.some((l) => l.vat_code)) {
      const productNos = [...new Set(rows.map(productFor).filter((x): x is string => !!x))]
      const groupByProduct = await groupByProductNo(creds, productNos)
      const vat = groupByProduct ? await vatByGroup(creds, customerNo, [...groupByProduct.values()]) : null
      vatLookup = groupByProduct && vat ? 'ok' : 'failed'
      mismatches = rows.flatMap((l, i) => {
        if (!l.vat_code) return []
        const no = productFor(l)!
        const g = groupByProduct?.get(no)
        const code = vat && g !== undefined ? vat.get(g) : undefined
        if (code === undefined || normVat(code) === normVat(l.vat_code)) return []
        return [{ line: i + 1, description: l.description.slice(0, 80), product: no, operia: l.vat_code, economic: code }]
      })
      if (mismatches.length > 0 && !body.ignoreVat) return json({ ok: false, reason: 'vat_mismatch', mismatches }, 200)
    }

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
        product: { productNumber: productFor(l) },
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
    //
    // Tilsidesat momskontrol skrives i revisionsrækken: hvem (auth.uid i
    // RPC'en), hvilke linjer/produkter/koder — og om opslaget overhovedet
    // lykkedes. Ellers ligner den overførsel en, der bestod kontrollen.
    const detail: Record<string, unknown> = body.ignoreVat
      ? { vat_override: { lookup: vatLookup, mismatches } }
      : {}
    const { error } = await asCaller.rpc('transfer_invoice_draft', {
      p_draft_id: draft.id,
      p_invoice_no: null,
      p_system: 'economic',
      p_external_id: draftNo,
      p_detail: detail,
    })
    if (error) return json({ error: error.message, draftNo }, 400)

    let invoiceNo: string | null = null
    let recorded = false
    if (cfg.accounting_auto_book) {
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

// mail-config — skriver og tester e-mail-udbyderens hemmelighed.
//
// Kun platform-admin (DCA): e-mail-udbyderen er platformens eget valg, ikke
// kundens. Samme mønster som economic-config:
//   save_api_key / clear_api_key → platform_secrets['<udbyder>_api_key']
//   test                         → et opslag hos udbyderen der både beviser at
//                                  nøglen virker OG at afsenderen er godkendt
//
// `provider` i kaldet afgør hvilken nøgle der skrives. Udelades den, gælder
// den udbyder der er VALGT — så det gamle Brevo-only-kald stadig virker.
//
// Nøglen går KUN denne vej: platform_secrets har hverken RLS-politikker eller
// grants, så den kan ikke læses gennem PostgREST. Browseren kan sætte en ny
// værdi og se "sat ✓" (spejlet af trigger), men aldrig læse den igen.
// 'test' returnerer kontonavn/afsenderstatus — aldrig nøglen.
//
// Resend har bevidst ingen handling her: dens nøgle er en edge-secret
// (RESEND_API_KEY) sat fra CLI'en, og den bliver liggende som fallback.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { isPlatformAdmin } from '../_shared/user-admin.ts'
import { mailConfig, parseFrom, resetMailConfigCache } from '../_shared/send-email.ts'

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

// Nøglenavnet i platform_secrets pr. udbyder. Resend står bevidst ikke her:
// dens nøgle er en edge-secret sat fra CLI'en og bliver liggende som fallback.
const SECRET_KEY: Record<string, string> = {
  brevo: 'brevo_api_key',
  ahasend: 'ahasend_api_key',
}

type Action = 'save_api_key' | 'clear_api_key' | 'test'
type Body = { action?: Action; secret?: string; provider?: string }

// Brevo afviser afsendere den ikke kender. Fælden er at send-API'et svarer 201
// med et messageId ALLIGEVEL — afvisningen sker først i behandlingen bagefter og
// dukker kun op som et 'error'-event:
//   "Sending has been rejected because the sender you used … is not valid.
//    Validate your sender or authenticate your domain"
// Observeret i drift 2026-09-08. Derfor tjekkes det her, hvor det kan ses FØR
// den første rigtige mail.
//
// Brevo godkender en afsender ad to veje, og begge tæller:
//   1. adressen er verificeret enkeltvis  (GET /v3/senders)
//   2. HELE domænet er autentificeret     (GET /v3/senders/domains, DKIM/SPF)
// Kun at kigge på (1) ville give falsk alarm for enhver adresse på et
// autentificeret domæne — netop den opsætning man ender med i drift.
async function senderVerified(apiKey: string, from: string): Promise<boolean | null> {
  const wanted = parseFrom(from).email.toLowerCase()
  const at = wanted.lastIndexOf('@')
  if (at <= 0) return null
  const domain = wanted.slice(at + 1)

  const get = async (path: string) => {
    const res = await fetch(`https://api.brevo.com/v3/${path}`, {
      headers: { 'api-key': apiKey, Accept: 'application/json' },
    })
    // Manglende rettighed på nøglen er ikke en dom — så svarer vi "ved ikke".
    return res.ok ? await res.json().catch(() => null) : null
  }

  const [sendersData, domainsData] = await Promise.all([get('senders'), get('senders/domains')])
  if (sendersData === null && domainsData === null) return null

  const senders = (sendersData?.senders ?? []) as { email?: string; active?: boolean }[]
  if (senders.some((s) => (s.email ?? '').toLowerCase() === wanted && s.active !== false)) return true

  const domains = (domainsData?.domains ?? []) as {
    domain_name?: string
    authenticated?: boolean
  }[]
  return domains.some(
    (d) => (d.domain_name ?? '').toLowerCase() === domain && d.authenticated === true,
  )
}

/**
 * AhaSend: ét opslag beviser tre ting på én gang — at nøglen virker (401 ellers),
 * at account_id peger på den rigtige konto (404 ellers), og om afsenderens
 * DOMÆNE er tilføjet og DNS-verificeret. AhaSend sender kun fra verificerede
 * domæner, så det sidste er den fælde der ellers først dukker op på den første
 * rigtige mail — samme fælde som Brevos uverificerede afsender.
 */
async function ahasendCheck(
  apiKey: string,
  accountId: string,
  from: string,
): Promise<{ ok: boolean; reason?: string; senderVerified?: boolean | null }> {
  const wanted = parseFrom(from).email.toLowerCase()
  const at = wanted.lastIndexOf('@')
  const domain = at > 0 ? wanted.slice(at + 1) : ''

  let res: Response
  try {
    res = await fetch(`https://api.ahasend.com/v2/accounts/${accountId}/domains`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    })
  } catch (e) {
    console.warn('ahasend /domains fejlede:', e instanceof Error ? e.message : e)
    return { ok: false, reason: 'network' }
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'unauthorized' }
  if (res.status === 404) return { ok: false, reason: 'account_not_found' }
  if (!res.ok) {
    console.warn('ahasend /domains svarede', res.status, (await res.text().catch(() => '')).slice(0, 300))
    return { ok: false, reason: res.status >= 500 ? 'provider_error' : 'rejected' }
  }

  const payload = await res.json().catch(() => null)
  const rows = (payload?.data ?? payload?.domains ?? []) as Record<string, unknown>[]
  if (!Array.isArray(rows) || rows.length === 0) {
    // Nøglen virker, men vi kan ikke bedømme afsenderen — sig "ved ikke" frem
    // for at påstå at den er forkert.
    return { ok: true, senderVerified: domain ? false : null }
  }
  const row = rows.find((d) => String(d.domain ?? d.name ?? '').toLowerCase() === domain)
  if (!row) return { ok: true, senderVerified: false }
  // Feltnavnet for "DNS er på plads" er ikke garanteret det samme på tværs af
  // API-versioner — accepter de kendte, og svar "ved ikke" hvis ingen findes.
  const flags = [row.dns_valid, row.verified, row.active, row.dns_verified]
  const known = flags.find((v) => typeof v === 'boolean')
  return { ok: true, senderVerified: known === undefined ? null : (known as boolean) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: userData, error: userErr } = await asCaller.auth.getUser()
  if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401)
  const callerId = userData.user.id

  const body = (await req.json().catch(() => ({}))) as Body
  const action = body.action
  if (!action) return json({ error: 'action_required' }, 400)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  if (!(await isPlatformAdmin(admin, callerId))) return json({ error: 'forbidden' }, 403)

  // Hvilken udbyder gælder kaldet? Eksplicit angivet vinder; ellers den valgte.
  const { data: settings } = await admin
    .from('platform_settings')
    .select('email_provider, ahasend_account_id')
    .limit(1)
    .maybeSingle()
  const provider = (body.provider ?? settings?.email_provider ?? '').trim()
  const secretKey = SECRET_KEY[provider]

  if (action === 'save_api_key' || action === 'clear_api_key') {
    if (!secretKey) return json({ error: 'provider_has_no_key' }, 400)
    const secret = action === 'save_api_key' ? (body.secret ?? '').trim() : ''
    if (action === 'save_api_key' && !secret) return json({ error: 'secret_required' }, 400)

    const { error } = await admin
      .from('platform_secrets')
      .upsert({ key: secretKey, value: secret || null, updated_by: callerId }, { onConflict: 'key' })
    if (error) return json({ error: 'save_failed', detail: error.message }, 500)

    // Denne isolat har måske allerede cachet den gamle konfiguration.
    resetMailConfigCache()

    const { error: auditErr } = await admin.rpc('record_audit', {
      p_company_id: null,
      p_action: action === 'save_api_key' ? 'email.api_key_set' : 'email.api_key_cleared',
      p_entity_type: 'platform_settings',
      p_entity_id: 'platform',
      p_summary: null,
      p_detail: { provider },
      p_actor: callerId,
    })
    if (auditErr) console.error('record_audit fejlede:', auditErr.message)
    return json({ ok: true })
  }

  if (action !== 'test') return json({ error: 'unknown_action' }, 400)

  // ── test: hvem hører nøglen til, og er afsenderen verificeret? ───────────
  // HVER test logges — også de mislykkede. Uden det efterlod et tryk på
  // knappen intet spor: spørgsmålet "kørte testen overhovedet, og hvad sagde
  // den?" kunne kun besvares af den der stod og kiggede på skærmen.
  // '*_failed' giver automatisk niveau 'error' i audit_level.
  const auditTest = async (ok: boolean, detail: Record<string, unknown>) => {
    const { error } = await admin.rpc('record_audit', {
      p_company_id: null,
      p_action: ok ? 'email.provider_tested' : 'email.provider_test_failed',
      p_entity_type: 'platform_settings',
      p_entity_id: 'platform',
      p_summary: null,
      p_detail: { provider, ...detail },
      p_actor: callerId,
    })
    if (error) console.error('record_audit fejlede:', error.message)
  }

  // Cachen springes over, så knappen tester det der lige er gemt.
  resetMailConfigCache()
  const cfg = await mailConfig()
  // Testen gælder den VALGTE udbyder — ikke den man måtte have peget på i
  // kaldet, for det er den valgte der rent faktisk sender.
  if (provider && cfg.provider !== provider) {
    await auditTest(false, { reason: 'not_selected' })
    return json({ ok: false, reason: 'not_selected' })
  }
  if (cfg.provider === 'resend') {
    // Resends nøgle er en edge-secret og er bevidst kun en send-nøgle; der er
    // intet opslag at teste med.
    await auditTest(false, { reason: 'no_test_for_provider' })
    return json({ ok: false, reason: 'no_test_for_provider' })
  }
  if (!cfg.apiKey) {
    await auditTest(false, { reason: 'api_key_missing' })
    return json({ ok: false, reason: 'api_key_missing' })
  }
  if (!cfg.from) {
    await auditTest(false, { reason: 'sender_missing' })
    return json({ ok: false, reason: 'sender_missing' })
  }

  if (cfg.provider === 'ahasend') {
    if (!cfg.accountId) {
      await auditTest(false, { reason: 'account_id_missing' })
      return json({ ok: false, reason: 'account_id_missing' })
    }
    const r = await ahasendCheck(cfg.apiKey, cfg.accountId, cfg.from)
    await auditTest(r.ok, { reason: r.reason ?? null, sender_verified: r.senderVerified ?? null })
    if (!r.ok) return json({ ok: false, reason: r.reason })
    return json({
      ok: true,
      accountEmail: null,
      companyName: cfg.accountId,
      plan: null,
      from: cfg.from,
      senderVerified: r.senderVerified ?? null,
    })
  }

  let res: Response
  try {
    res = await fetch('https://api.brevo.com/v3/account', {
      headers: { 'api-key': cfg.apiKey, Accept: 'application/json' },
    })
  } catch (e) {
    console.warn('brevo /account fejlede:', e instanceof Error ? e.message : e)
    await auditTest(false, { reason: 'network' })
    return json({ ok: false, reason: 'network' })
  }
  if (!res.ok) {
    // Brevos fejltekst bliver serverside — kun årsagskoden når ud. Teksten er
    // dog det eneste der skelner "nøglen er forkert" fra "nøglen må ikke bruges
    // fra denne IP", så den skal i det mindste i edge-loggen.
    const body = (await res.text().catch(() => '')).slice(0, 300)
    console.warn('brevo /account svarede', res.status, body)
    const reason = res.status === 401
      ? (/unrecognised ip|unrecognized ip/i.test(body) ? 'ip_blocked' : 'unauthorized')
      : res.status >= 500
        ? 'provider_error'
        : 'rejected'
    await auditTest(false, { reason, status: res.status })
    return json({ ok: false, reason })
  }

  const account = (await res.json().catch(() => ({}))) as {
    email?: string
    companyName?: string
    plan?: { type?: string; credits?: number }[]
  }
  const verified = await senderVerified(cfg.apiKey, cfg.from).catch(() => null)
  await auditTest(true, { sender_verified: verified })

  return json({
    ok: true,
    accountEmail: account.email ?? null,
    companyName: account.companyName ?? null,
    plan: account.plan?.[0]?.type ?? null,
    from: cfg.from,
    senderVerified: verified,
  })
})

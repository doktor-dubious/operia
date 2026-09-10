// email-inbound — receiving leg for the automatic-email data-transfer channel.
//
// TO UDBYDERE, ét endpoint. Valget står i platform_settings.email_inbound_provider
// og afgør kun hvilke MX-poster der skal stå i DNS; funktionen her tager imod
// begge nyttelast-former, så en omlægning kan ske uden nedetid (peg MX om,
// begge veje virker imens):
//   • Postmark inbound — én MX-post på lejer-domænet (fx
//     operia.predictioninstitute.com → inbound.postmarkapp.com). Vedhæftninger
//     kommer MED i JSON'en, base64-kodede.
//   • Brevo inbound (EU) — to MX-poster (inbound1/inbound2.sendinblue.com).
//     Nyttelasten er et `items`-array, og vedhæftninger kommer IKKE med: hvert
//     bilag har et DownloadToken der byttes til bytes via Brevos API
//     (_shared/brevo.ts).
//
// Uanset udbyder er resten den samme, og den spejler SFTP-benet nøjagtigt:
//   • take the envelope recipient, resolve its local part → company via
//     email_name (globally unique)
//   • check the channel is enabled (platform + company) and the domain matches
//   • land the first CSV attachment in imports/{company_id}/ (same bucket as SFTP)
//   • record inbound_files (source='email') → audit data_transfer.received
//   • acknowledge instantly, run the import in the BACKGROUND (waitUntil)
// Begge udbydere leverer at-least-once; the unique index on (source, message_id)
// makes a redelivery a no-op instead of a second import.
//
// Deploy WITH --no-verify-jwt (hverken Postmark eller Brevo sender en Supabase-JWT).
// Guarded by EMAIL_HOOK_SECRET via hookAuthorized — preferred webhook URL form is
// HTTP basic auth (https://hook:SECRET@…/email-inbound), which Postmark moves into
// the Authorization header; ?token=… stays accepted (og er den form Brevo kan).

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { hookAuthorized } from '../_shared/hook-auth.ts'
import { brevoApiKey } from '../_shared/brevo.ts'
import {
  type BrevoInbound,
  type InboundAttachment,
  type InboundMessage,
  type PostmarkHeader,
  type PostmarkInbound,
  normalizeInbound,
} from '../_shared/inbound-mail.ts'
import { processInboundImport, runBackground } from '../_shared/import-runner.ts'

// Afsenderverifikation (defense-in-depth mod spoofing). Den modtagende MTA
// tilføjer et Authentication-Results-header med spf/dkim/dmarc-resultater; From
// (afsenderdomænet) kan trivielt forfalskes uden disse.
//
// To ting gør parsningen robust mod manipulation:
//   1. ALLE Authentication-Results-headere læses, og for hver mekanisme gælder
//      det DÅRLIGSTE resultat (fail > none/softfail > pass). Et header en
//      angriber selv har lagt i mailen kan altså kun forværre dens egen status,
//      aldrig overdøve udbyderens fail/none med et falskt "pass".
//   2. SPF/DKIM tæller kun som bevis for From, når domænet de faktisk gælder
//      (smtp.mailfrom hhv. header.d) er JUSTERET mod From-domænet. Rå spf=pass
//      beviser kun afsenderens EGET envelope-domæne — ellers kunne en angriber
//      sende fra eget domæne med forfalsket From og slippe forbi allowlisten.
type MechResult = { result: string | null; domain: string | null }
type AuthResults = {
  spf: MechResult // resultat + smtp.mailfrom-domænet det gælder
  dkim: MechResult[] // alle signaturer (resultat + header.d)
  dmarc: string | null
}

// Dårligst-af-rangering: pass < alt andet (none/softfail/…) < fail.
function badness(result: string | null): number {
  if (result === null) return -1
  if (result === 'pass') return 0
  if (result === 'fail') return 2
  return 1
}

function parseAuthHeaders(headers: PostmarkHeader[]): AuthResults {
  const ars = headers
    .filter((h) => (h.Name || '').toLowerCase() === 'authentication-results')
    .map((h) => h.Value || '')
  let spf: MechResult = { result: null, domain: null }
  const dkim: MechResult[] = []
  let dmarc: string | null = null

  for (const ar of ars) {
    for (const rawClause of ar.split(';')) {
      const clause = rawClause.trim()
      let m: RegExpExecArray | null
      if ((m = /^spf=(\w+)/i.exec(clause))) {
        const d = /\bsmtp\.mailfrom=(?:[^\s@]*@)?([^\s]+)/i.exec(clause)
        const cand = { result: m[1].toLowerCase(), domain: d ? d[1].toLowerCase() : null }
        if (badness(cand.result) > badness(spf.result)) spf = cand
      } else if ((m = /^dkim=(\w+)/i.exec(clause))) {
        const d = /\bheader\.d=([^\s]+)/i.exec(clause)
        dkim.push({ result: m[1].toLowerCase(), domain: d ? d[1].toLowerCase() : null })
      } else if ((m = /^dmarc=(\w+)/i.exec(clause))) {
        const r = m[1].toLowerCase()
        if (badness(r) > badness(dmarc)) dmarc = r
      }
    }
  }

  // Fallback til Received-SPF: "Pass (…) envelope-from=…" hvis intet
  // Authentication-Results-header havde et spf-resultat.
  if (!spf.result) {
    const rspf = (headers.find((h) => (h.Name || '').toLowerCase() === 'received-spf')?.Value || '').trim()
    if (rspf) {
      const result = (rspf.split(/\s+/)[0] || '').toLowerCase() || null
      const d = /\benvelope-from=["<]?(?:[^\s@"<>]*@)?([^\s">;]+)/i.exec(rspf)
      spf = { result, domain: d ? d[1].toLowerCase() : null }
    }
  }
  return { spf, dkim, dmarc }
}

// Justering (relaxed alignment): domænet matcher From-domænet eller er
// over-/underdomæne af det (bounce.kunde.dk ~ kunde.dk).
function aligned(domain: string | null, fromDomain: string | null): boolean {
  if (!domain || !fromDomain) return false
  return domain === fromDomain || domain.endsWith('.' + fromDomain) || fromDomain.endsWith('.' + domain)
}

// Spoof-afgørelse. To niveauer (styret af platform_settings):
//   Standard (undgå falske positiver på legitim post): DMARC=fail, eller hård
//     SPF-fejl uden en justeret DKIM-pass → spoof. Uden NOGEN resultater
//     afvises IKKE her — så bærer afsender-allowlisten forsvaret alene.
//   Konservativ (strict): kræv et justeret positivt bevis for From-domænet
//     (DMARC=pass, eller SPF/DKIM=pass for et justeret domæne). DMARC none og
//     manglende DMARC behandles ens.
function isSpoofed(auth: AuthResults, fromDomain: string | null, strict: boolean): boolean {
  if (auth.dmarc === 'fail') return true
  if (auth.dmarc === 'pass') return false
  const spfAligned = auth.spf.result === 'pass' && aligned(auth.spf.domain, fromDomain)
  const dkimAligned = auth.dkim.some((d) => d.result === 'pass' && aligned(d.domain, fromDomain))
  if (strict) return !(spfAligned || dkimAligned)
  return auth.spf.result === 'fail' && !dkimAligned
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function admin(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
}

// Local part + domain fra en adresse som "nordwind@operia.predictioninstitute.com".
// Kan komme som "Navn <nordwind@…>" — træk det inderste ud.
function parseAddress(raw: string): { local: string; domain: string } | null {
  const m = raw.match(/<([^>]+)>/)
  const addr = (m ? m[1] : raw).trim().toLowerCase()
  const at = addr.lastIndexOf('@')
  if (at <= 0 || at === addr.length - 1) return null
  return { local: addr.slice(0, at), domain: addr.slice(at + 1) }
}

// Kun basenavn, ingen path-traversal; standard hvis intet fornuftigt navn.
// '.'/'..' ville give en ugyldig storage-nøgle (og en evig retry-løkke hos
// udbyderen på 500-svaret) — også de falder tilbage til standardnavnet.
function safeFileName(name: string | undefined | null): string {
  const base = String(name ?? '').split(/[\\/]/).pop()?.trim() || ''
  const cleaned = base.replace(/[^\w.\- ]+/g, '_')
  if (!cleaned || /^[. ]+$/.test(cleaned)) return 'inbound.csv'
  return cleaned
}

function isCsv(att: InboundAttachment): boolean {
  const name = (att.name || '').toLowerCase()
  const type = (att.contentType || '').toLowerCase()
  return name.endsWith('.csv') || type.includes('csv') || type === 'application/vnd.ms-excel'
}

// En afvist inbound e-mail logges som en afvist import_runs-kørsel, så den både
// dukker op i Import/Eksport → Log og i Logs-fremviseren (import_runs-triggeren
// skriver 'import.rejected' til audit_log) — kunden får en alarm i stedet for
// en tavs afvisning.
async function logRejected(
  db: SupabaseClient,
  companyId: string,
  fileName: string | null,
  from: string,
  code: string,
) {
  // Årsagen gemmes som KODE (sproguafhængig) — Logs oversætter den ved visning.
  const { error } = await db.from('import_runs').insert({
    company_id: companyId,
    kind: 'employees_csv',
    file_name: fileName,
    status: 'rejected',
    rows_total: 0,
    rejected_count: 1,
    errors: [{ row: 0, code }],
    created_by_email: `email:${from}`,
  })
  if (error) console.error('kunne ikke logge afvist e-mail-import:', error)
}

type PlatformEmailSettings = {
  email_enabled: boolean | null
  email_base_domain: string | null
  email_antispoof_enabled: boolean | null
  email_antispoof_strict: boolean | null
  email_allowlist_required: boolean | null
}

type Handled = { body: Record<string, unknown>; status?: number }

/** Én besked hele vejen igennem. Kaster aldrig — svaret bærer udfaldet. */
async function handleMessage(
  db: SupabaseClient,
  platform: PlatformEmailSettings,
  msg: InboundMessage,
): Promise<Handled> {
  const to = parseAddress(msg.recipient)
  const from = msg.from
  const fromAddr = parseAddress(from)
  if (!to) return { body: { ignored: 'bad_recipient' } }

  // Domænet skal matche det konfigurerede modtagedomæne (forsvar — udbyderen
  // leverer kun for det domæne vi peger MX på).
  const baseDomain = String(platform.email_base_domain ?? '').trim().toLowerCase()
  if (baseDomain && to.domain !== baseDomain) return { body: { ignored: 'domain_mismatch' } }

  // Local part (email_name, globalt unik) → virksomhed. email_name gemmes uden
  // domæne, så nordwind@… matcher email_name='nordwind'.
  const { data: secret } = await db
    .from('company_data_transfer_secret')
    .select('company_id, email_allowed_senders')
    .eq('email_name', to.local)
    .maybeSingle()
  if (!secret?.company_id) return { body: { ignored: 'unknown_recipient' } }
  const companyId = secret.company_id

  // Per-virksomhed-toggle skal også være slået til.
  const { data: company } = await db
    .from('company_data_transfer')
    .select('email_enabled')
    .eq('company_id', companyId)
    .maybeSingle()
  if (!company?.email_enabled) return { body: { ignored: 'company_email_disabled' } }

  // Afsenderverifikation (defense-in-depth): en forfalsket From fanges her, FØR
  // allowlisten — ellers kunne en spoofet adresse der matcher listen slippe
  // igennem. Logges som SIKKERHEDShændelse på error-niveau (lyser rødt i Logs).
  const auth = parseAuthHeaders(msg.headers)
  if (platform.email_antispoof_enabled && isSpoofed(auth, fromAddr?.domain ?? null, !!platform.email_antispoof_strict)) {
    const { error: rpcErr } = await db.rpc('log_gateway_event', {
      p_company_id: companyId,
      p_action: 'data_transfer.spoof_rejected',
      // Sproguafhængig summary (kun afsenderen) — Logs-fremviseren gengiver
      // selve sætningen fra i18n ud fra detail, så den følger UI-sproget.
      p_summary: from || 'unknown',
      p_detail: {
        from,
        spf: auth.spf.result,
        spf_domain: auth.spf.domain,
        dkim: auth.dkim.map((d) => d.result).join(',') || null,
        dkim_domains: auth.dkim.map((d) => d.domain).join(',') || null,
        dmarc: auth.dmarc,
      },
    })
    if (rpcErr) console.error('kunne ikke logge spoof-hændelse:', rpcErr)
    return { body: { ignored: 'sender_auth_failed' } }
  }

  // Afsender-allowlist (sikkerhed): når virksomheden har konfigureret tilladte
  // afsendere, SKAL From matche en af dem (fuld adresse eller @domæne). Ellers
  // afvises mailen og logges — så en fremmed ikke kan poste stamdata.
  const allowed = (secret.email_allowed_senders ?? []) as string[]
  const norm = allowed.map((a) => a.trim().toLowerCase()).filter(Boolean)
  if (norm.length === 0) {
    // Tom liste: normalt ingen restriktion (bagudkompatibelt; UI advarer). Men
    // når platformen kræver en allowlist (secure-by-default), afvises alt.
    if (platform.email_allowlist_required) {
      await logRejected(db, companyId, null, from || to.local, 'allowlistRequired')
      return { body: { ignored: 'allowlist_required' } }
    }
  } else {
    const ok =
      !!fromAddr &&
      norm.some((a) =>
        a.startsWith('@') ? fromAddr.domain === a.slice(1) : `${fromAddr.local}@${fromAddr.domain}` === a,
      )
    if (!ok) {
      await logRejected(db, companyId, null, from || 'ukendt', 'senderNotAllowed')
      return { body: { ignored: 'sender_not_allowed' } }
    }
  }

  // Vedhæftning skal være en CSV — ellers afvis OG log (kunden får en alarm).
  const csv = msg.attachments.find(isCsv)
  if (!csv) {
    await logRejected(db, companyId, null, from || to.local, 'noCsvAttachment')
    return { body: { ignored: 'no_csv_attachment' } }
  }

  // Hent indholdet (Postmark: afkod base64; Brevo: hent via DownloadToken).
  let bytes: Uint8Array
  try {
    bytes = await csv.bytes()
  } catch (err) {
    console.error('kunne ikke hente vedhæftning:', err)
    await logRejected(db, companyId, safeFileName(csv.name), from || to.local, 'badAttachment')
    return { body: { error: 'bad_attachment' }, status: 400 }
  }
  if (bytes.byteLength === 0) {
    // En tom fil ville blive lagt i Storage og sat i kø som en import uden
    // rækker — deaktivering af alle medarbejdere er netop det, en tom fil
    // betyder for upsert-semantikken. Afvis og alarmér i stedet.
    await logRejected(db, companyId, safeFileName(csv.name), from || to.local, 'badAttachment')
    return { body: { error: 'empty_attachment' }, status: 400 }
  }
  const fileName = safeFileName(csv.name)
  // Unik nøgle pr. levering: HR-eksporter hedder typisk det samme hver gang,
  // og en fast nøgle ville lade to leveringer overskrive/slette hinandens
  // objekt mens deres baggrundsimports kører.
  const objectPath = `${companyId}/${crypto.randomUUID()}-${fileName}`

  const { error: upErr } = await db.storage
    .from('imports')
    .upload(objectPath, bytes, { contentType: 'text/csv', upsert: false })
  if (upErr) {
    console.error('storage upload failed:', upErr)
    return { body: { error: 'upload_failed' }, status: 500 }
  }

  const { data: inbound, error: inboundErr } = await db
    .from('inbound_files')
    .insert({
      company_id: companyId,
      source: 'email',
      object_path: objectPath,
      file_name: fileName,
      file_size: bytes.byteLength,
      status: 'received',
      message_id: msg.messageId,
    })
    .select('id')
    .single()
  if (inboundErr || !inbound) {
    // 23505 = unik (source, message_id): udbyderen leverede samme mail igen —
    // den første levering behandler/behandlede filen, så kvittér uden retry.
    if (inboundErr?.code === '23505') return { body: { ignored: 'duplicate_delivery' } }
    console.error('inbound insert failed:', inboundErr)
    return { body: { error: 'insert_failed' }, status: 500 }
  }

  // Kvittér med det samme; importér i baggrunden (store filer / mange rækker).
  const maybe = runBackground(
    processInboundImport(db, {
      companyId,
      objectPath,
      fileName,
      inboundId: inbound.id,
      actor: `email:${from || to.local}`,
    }),
  )
  if (maybe) await maybe // fallback uden waitUntil
  return { body: { ok: true, queued: true } }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!hookAuthorized(req, 'EMAIL_HOOK_SECRET')) return json({ error: 'unauthorized' }, 401)

  let raw: PostmarkInbound & BrevoInbound
  try {
    raw = await req.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }

  const db = admin()

  // Kanalen skal være slået til globalt.
  const { data: platform } = await db
    .from('platform_settings')
    .select(
      'email_enabled, email_base_domain, email_antispoof_enabled, email_antispoof_strict, email_allowlist_required',
    )
    .maybeSingle()
  if (!platform?.email_enabled) return json({ ignored: 'email_disabled' })

  // Brevo-nøglen hentes ÉN gang pr. kald, og kun hvis en vedhæftning skal
  // hentes — Postmark-leverancer rører den aldrig.
  let keyPromise: Promise<string> | null = null
  const apiKey = () => {
    keyPromise ??= brevoApiKey(db).then((k) => {
      if (!k) throw new Error('brevo_not_configured')
      return k
    })
    return keyPromise
  }

  const messages = normalizeInbound(raw, apiKey)
  if (messages.length === 0) return json({ ignored: 'no_messages' })

  // Brevo kan samle flere beskeder i én levering. Hver behandles for sig, og
  // ÉN afvist besked må ikke spolere de øvrige — derfor samles udfaldene.
  const results: Record<string, unknown>[] = []
  let status = 200
  for (const msg of messages) {
    const handled = await handleMessage(db, platform as PlatformEmailSettings, msg)
    results.push(handled.body)
    // En hård fejl (upload/insert) skal give ikke-2xx, så udbyderen prøver igen.
    if (handled.status && handled.status > status) status = handled.status
  }
  return json(messages.length === 1 ? results[0] : { results }, status)
})

// email-inbound — receiving leg for the automatic-email data-transfer channel.
// Provider: Postmark inbound. A single MX record for the tenant domain (e.g.
// operia.predictioninstitute.com → inbound.postmarkapp.com) delivers all mail to
// Postmark, which POSTs the parsed message here as JSON (attachments already
// base64-encoded). We then mirror the SFTP leg exactly:
//   • take the envelope recipient, resolve its local part → company via
//     email_name (globally unique)
//   • check the channel is enabled (platform + company) and the domain matches
//   • land the first CSV attachment in imports/{company_id}/ (same bucket as SFTP)
//   • record inbound_files (source='email') → audit data_transfer.received
//   • acknowledge instantly, run the import in the BACKGROUND (waitUntil)
// Postmark delivers at-least-once; the unique index on (source, message_id)
// makes a redelivery a no-op instead of a second import.
//
// Deploy WITH --no-verify-jwt (Postmark sends no Supabase JWT). Guarded by
// EMAIL_HOOK_SECRET via hookAuthorized — preferred webhook URL form is HTTP
// basic auth (https://hook:SECRET@…/email-inbound), which Postmark moves into
// the Authorization header; ?token=… stays accepted for backwards compat.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { decodeBase64 } from 'jsr:@std/encoding@1/base64'
import { hookAuthorized } from '../_shared/hook-auth.ts'
import { processInboundImport, runBackground } from '../_shared/import-runner.ts'

// Postmark inbound webhook (delmængde af felterne vi bruger).
type PostmarkAttachment = { Name?: string; Content?: string; ContentType?: string }
type PostmarkHeader = { Name?: string; Value?: string }
type PostmarkInbound = {
  MessageID?: string
  OriginalRecipient?: string
  ToFull?: { Email?: string }[]
  From?: string
  FromFull?: { Email?: string }
  Attachments?: PostmarkAttachment[]
  Headers?: PostmarkHeader[]
}

// Afsenderverifikation (defense-in-depth mod spoofing). Postmarks modtagende MTA
// tilføjer et Authentication-Results-header med spf/dkim/dmarc-resultater; From
// (afsenderdomænet) kan trivielt forfalskes uden disse.
//
// To ting gør parsningen robust mod manipulation:
//   1. ALLE Authentication-Results-headere læses, og for hver mekanisme gælder
//      det DÅRLIGSTE resultat (fail > none/softfail > pass). Et header en
//      angriber selv har lagt i mailen kan altså kun forværre dens egen status,
//      aldrig overdøve Postmarks fail/none med et falskt "pass".
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
// '.'/'..' ville give en ugyldig storage-nøgle (og en evig Postmark-retry-løkke
// på 500-svaret) — også de falder tilbage til standardnavnet.
function safeFileName(name: string | undefined | null): string {
  const base = String(name ?? '').split(/[\\/]/).pop()?.trim() || ''
  const cleaned = base.replace(/[^\w.\- ]+/g, '_')
  if (!cleaned || /^[. ]+$/.test(cleaned)) return 'inbound.csv'
  return cleaned
}

function isCsv(att: PostmarkAttachment): boolean {
  const name = (att.Name || '').toLowerCase()
  const type = (att.ContentType || '').toLowerCase()
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

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!hookAuthorized(req, 'EMAIL_HOOK_SECRET')) return json({ error: 'unauthorized' }, 401)

  let body: PostmarkInbound
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }

  // Envelope-modtager: OriginalRecipient er den adresse mailen faktisk blev leveret
  // til; falder tilbage til To-headeren.
  const recipientRaw = String(body.OriginalRecipient ?? body.ToFull?.[0]?.Email ?? '')
  const to = parseAddress(recipientRaw)
  const from = String(body.FromFull?.Email ?? body.From ?? '')
  const fromAddr = parseAddress(from)
  if (!to) return json({ ignored: 'bad_recipient' })

  const db = admin()

  // Kanalen skal være slået til globalt, og domænet skal matche det konfigurerede
  // modtagedomæne (forsvar — Postmark leverer kun for det domæne vi peger MX på).
  const { data: platform } = await db
    .from('platform_settings')
    .select(
      'email_enabled, email_base_domain, email_antispoof_enabled, email_antispoof_strict, email_allowlist_required',
    )
    .maybeSingle()
  if (!platform?.email_enabled) return json({ ignored: 'email_disabled' })
  const baseDomain = String(platform.email_base_domain ?? '').trim().toLowerCase()
  if (baseDomain && to.domain !== baseDomain) return json({ ignored: 'domain_mismatch' })

  // Local part (email_name, globalt unik) → virksomhed. email_name gemmes uden
  // domæne, så nordwind@… matcher email_name='nordwind'.
  const { data: secret } = await db
    .from('company_data_transfer_secret')
    .select('company_id, email_allowed_senders')
    .eq('email_name', to.local)
    .maybeSingle()
  if (!secret?.company_id) return json({ ignored: 'unknown_recipient' })
  const companyId = secret.company_id

  // Per-virksomhed-toggle skal også være slået til.
  const { data: company } = await db
    .from('company_data_transfer')
    .select('email_enabled')
    .eq('company_id', companyId)
    .maybeSingle()
  if (!company?.email_enabled) return json({ ignored: 'company_email_disabled' })

  // Afsenderverifikation (defense-in-depth): en forfalsket From fanges her, FØR
  // allowlisten — ellers kunne en spoofet adresse der matcher listen slippe
  // igennem. Logges som SIKKERHEDShændelse på error-niveau (lyser rødt i Logs).
  const auth = parseAuthHeaders(body.Headers ?? [])
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
    return json({ ignored: 'sender_auth_failed' })
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
      return json({ ignored: 'allowlist_required' })
    }
  } else {
    const ok =
      !!fromAddr &&
      norm.some((a) =>
        a.startsWith('@') ? fromAddr.domain === a.slice(1) : `${fromAddr.local}@${fromAddr.domain}` === a,
      )
    if (!ok) {
      await logRejected(db, companyId, null, from || 'ukendt', 'senderNotAllowed')
      return json({ ignored: 'sender_not_allowed' })
    }
  }

  // Vedhæftning skal være en CSV — ellers afvis OG log (kunden får en alarm).
  const csv = (body.Attachments ?? []).find(isCsv)
  if (!csv?.Content) {
    await logRejected(db, companyId, null, from || to.local, 'noCsvAttachment')
    return json({ ignored: 'no_csv_attachment' })
  }

  // Afkod og læg i imports/{company_id}/ (samme bucket som SFTP).
  let bytes: Uint8Array
  try {
    bytes = decodeBase64(csv.Content)
  } catch {
    await logRejected(db, companyId, safeFileName(csv.Name), from || to.local, 'badAttachment')
    return json({ error: 'bad_attachment' }, 400)
  }
  const fileName = safeFileName(csv.Name)
  // Unik nøgle pr. levering: HR-eksporter hedder typisk det samme hver gang,
  // og en fast nøgle ville lade to leveringer overskrive/slette hinandens
  // objekt mens deres baggrundsimports kører.
  const objectPath = `${companyId}/${crypto.randomUUID()}-${fileName}`

  const { error: upErr } = await db.storage
    .from('imports')
    .upload(objectPath, bytes, { contentType: 'text/csv', upsert: false })
  if (upErr) {
    console.error('storage upload failed:', upErr)
    return json({ error: 'upload_failed' }, 500)
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
      message_id: body.MessageID ?? null,
    })
    .select('id')
    .single()
  if (inboundErr || !inbound) {
    // 23505 = unik (source, message_id): Postmark leverede samme mail igen —
    // den første levering behandler/behandlede filen, så kvittér uden retry.
    if (inboundErr?.code === '23505') return json({ ignored: 'duplicate_delivery' })
    console.error('inbound insert failed:', inboundErr)
    return json({ error: 'insert_failed' }, 500)
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
  return json({ ok: true, queued: true })
})

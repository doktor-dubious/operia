// send-asset-reminder — manager-udløst "Send påmindelse nu" for et åbent aktiv-
// udlån. Til forskel fra dispatch-asset-reminders (cron, service-role) kaldes
// denne fra browseren af en manager, så:
//
//   • Kalderen verificeres ud fra deres EGEN JWT, og rettigheden gentjekkes
//     server-side via can_write_assets(loanens company) — browseren er utroværdig
//     (se CLAUDE.md). Kun managers i lånets virksomhed (eller platform-admins)
//     kan sende. Det er den samme grænse som lend_asset/return_asset: kan man
//     administrere lånet, kan man rykke låneren. (Aktiver-PRODUKTET gates i nav/
//     side, ikke her — lige som lend_asset ikke kræver det.)
//   • Den betalingsfølsomme grænse er SMS: kanalen kræver sms_notifications-
//     featuren, så en manuel knap ikke kan sende SMS på DCA's GatewayAPI-regning.
//     E-mail (Resend, DCA's egen) er ikke gated her.
//   • Stilletid ignoreres bevidst: manageren har lige trykket "send nu".
//   • Hver afsendelse logges i asset_loan_notifications med kind='manual'
//     (undtaget dedup-indekset, så gentagne manuelle nudges er tilladt), og
//     kvitteringen/fejlen skrives til audit_log (asset.reminder_sent/_failed)
//     så den er synlig i Logs — fejl på 'error'-niveau.
//
// Skabelonteksten er FAST (asset_manual/-_sms i virksomhedens sprog) — ingen
// kaldersupplieret tekst, så endpointet ikke bliver et phishing-relay.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { sendSms } from '../_shared/send-sms.ts'
import { sendEmail } from '../_shared/send-email.ts'
import {
  classifySendError,
  copenhagenDate,
  fmtDate,
  maskRecipient,
  render,
  renderHtml,
} from '../_shared/notify.ts'

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

const EMAIL_KEY = 'asset_manual'
const SMS_KEY = 'asset_manual_sms'

type Body = { loan_id?: string }

type LoanRow = {
  id: string
  asset_id: string
  company_id: string
  to_name: string
  to_email: string | null
  to_phone: string | null
  expires_at: string | null
  returned_at: string | null
  company: {
    name: string | null
    default_language: string | null
    notify_email_enabled: boolean | null
    notify_sms_enabled: boolean | null
  } | null
  asset: { name: string | null; asset_tag: string | null } | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // 1) Verificér kalderen ud fra deres egen JWT.
  const authHeader = req.headers.get('Authorization') ?? ''
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await asCaller.auth.getUser()
  if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401)
  const callerId = userData.user.id

  const body = (await req.json().catch(() => ({}))) as Body
  const loanId = body.loan_id?.trim()
  if (!loanId) return json({ error: 'loan_id_required' }, 400)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  // 2) Hent udlånet (+ virksomhed + aktiv). Kun åbne udlån kan påmindes.
  const { data: loanData, error: loanErr } = await admin
    .from('asset_loans')
    .select(
      `id, asset_id, company_id, to_name, to_email, to_phone, expires_at, returned_at,
       company:companies (name, default_language, notify_email_enabled, notify_sms_enabled),
       asset:assets (name, asset_tag)`,
    )
    .eq('id', loanId)
    .maybeSingle()
  if (loanErr) return json({ error: 'query_failed', detail: loanErr.message }, 500)
  const loan = loanData as unknown as LoanRow | null
  if (!loan) return json({ error: 'loan_not_found' }, 404)
  if (loan.returned_at) return json({ error: 'loan_closed' }, 409)

  // 3) Autorisation: gentjek som kalderen (RLS-kontekst). can_write_assets ⇒
  //    manager i lånets virksomhed eller platform-admin.
  const { data: canWrite } = await asCaller.rpc('can_write_assets', {
    p_company_id: loan.company_id,
  })
  if (canWrite !== true) return json({ error: 'forbidden' }, 403)

  // 4) Kun den betalingsfølsomme SMS-kanal gates (sms_notifications-featuren) +
  //    virksomhedens/plaformens kanalvalg. Aktiver-produktet gates ikke her.
  const today = copenhagenDate(new Date())
  const validUntilOk = (v: string | null) => v == null || v >= today
  const [featRes, platformRes] = await Promise.all([
    admin
      .from('company_features')
      .select('valid_until')
      .eq('company_id', loan.company_id)
      .eq('feature_key', 'sms_notifications')
      .maybeSingle(),
    admin
      .from('platform_settings')
      .select('notify_email_enabled, notify_sms_enabled')
      .limit(1)
      .maybeSingle(),
  ])
  const smsFeatureOk = !!featRes.data && validUntilOk(featRes.data.valid_until)

  const co = loan.company
  const emailOn = co?.notify_email_enabled ?? platformRes.data?.notify_email_enabled ?? false
  const smsOn =
    (co?.notify_sms_enabled ?? platformRes.data?.notify_sms_enabled ?? false) && smsFeatureOk

  const channels: Array<'email' | 'sms'> = []
  if (emailOn && loan.to_email) channels.push('email')
  if (smsOn && loan.to_phone) channels.push('sms')
  // Ingen brugbar kanal (ingen kontaktvej, eller e-mail/SMS slået fra) er en
  // forklarlig tilstand for manageren, ikke en HTTP-fejl — 200 med kode, så
  // UI'et kan vise en pæn besked (som send-test-sms-mønstret).
  if (channels.length === 0) return json({ ok: false, code: 'no_channel' })

  // 5) Skabeloner (virksomheds-override → platform-fallback, sprog → da-fallback).
  const lang = (co?.default_language || 'da').slice(0, 2)
  const [ptplRes, ctplRes] = await Promise.all([
    admin.from('platform_templates').select('key, lang, title, body').in('key', [EMAIL_KEY, SMS_KEY]),
    admin
      .from('company_templates')
      .select('key, lang, title, body')
      .eq('company_id', loan.company_id)
      .in('key', [EMAIL_KEY, SMS_KEY]),
  ])
  const ptpls = ptplRes.data ?? []
  const ctpls = ctplRes.data ?? []
  const tpl = (key: string): { title: string; body: string } => {
    const co_ =
      ctpls.find((r) => r.key === key && r.lang === lang) ??
      ctpls.find((r) => r.key === key && r.lang === 'da')
    const pf =
      ptpls.find((r) => r.key === key && r.lang === lang) ??
      ptpls.find((r) => r.key === key && r.lang === 'da')
    return { title: co_?.title || pf?.title || '', body: co_?.body || pf?.body || '' }
  }

  const tokens: Record<string, string> = {
    recipient_name: loan.to_name ?? '',
    asset_name: loan.asset?.name || loan.asset?.asset_tag || '',
    expiry_date: loan.expires_at ? fmtDate(loan.expires_at, lang) : '',
    company_name: co?.name ?? '',
  }

  // 6) Send + log pr. kanal. Selve send-resultatet (også provider-fejl)
  //    returneres som 200, så UI'et kan vise det pænt.
  const results: Record<string, { ok: boolean; error?: string }> = {}
  let sent = 0
  for (const channel of channels) {
    const to = channel === 'email' ? loan.to_email! : loan.to_phone!
    const { title, body } = tpl(channel === 'email' ? EMAIL_KEY : SMS_KEY)
    if (!body) {
      results[channel] = { ok: false, error: 'no_template' }
      continue
    }

    let result: { ok: boolean; error?: string; id?: string }
    if (channel === 'email') {
      result = await sendEmail(to, render(title, tokens), renderHtml(body, tokens))
    } else {
      result = await sendSms(to, render(body, tokens))
    }

    await admin.from('asset_loan_notifications').insert({
      company_id: loan.company_id,
      loan_id: loan.id,
      asset_id: loan.asset_id,
      kind: 'manual',
      channel,
      lang,
      recipient: to,
      status: result.ok ? 'sent' : 'failed',
      provider_id: result.id ?? null,
      error: result.ok ? null : (result.error ?? '').slice(0, 500),
    })

    // Kvittering/fejl til Logs (audit_log). '.failed' udleder 'error'-niveau.
    await admin.rpc('log_notification_event', {
      p_company_id: loan.company_id,
      p_action: result.ok ? 'asset.reminder_sent' : 'asset.reminder_failed',
      p_entity_type: 'asset_loan',
      p_entity_id: loan.id,
      p_summary: `${tokens.asset_name || '—'}`,
      p_detail: {
        channel,
        recipient: maskRecipient(to),
        manual: true,
        asset_id: loan.asset_id,
        ...(result.ok
          ? {}
          : {
              reason: classifySendError(result.error ?? '', channel),
              error: (result.error ?? '').slice(0, 300),
            }),
      },
      p_actor: callerId,
    })

    results[channel] = { ok: result.ok, error: result.error }
    if (result.ok) sent++
  }

  return json({ ok: sent > 0, sent, channels, results })
})

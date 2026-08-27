// sales-lead — offentligt endpoint bag besparelsesberegneren på
// operia-info.predictioninstitute.com ("Få beregningen på mail").
//
// Tager besøgerens indtastninger, KLEMMER alle tal ind i felternes min/max og
// snapper til feltets step (klienten er utroet — vi genberegner selv totalen
// server-side og bruger aldrig klientens beløb), gemmer leadet i sales_leads
// FØR mailen sendes (et demo-ønske må ikke gå tabt, selv hvis Resend fejler)
// og sender beregningen som e-mail via Resend. Sætter LEAD_NOTIFY_EMAIL-
// secreten en intern notifikation på, sendes den også dertil.
//
// Misbrugsværn: honeypot-felt (bots svarer vi bare ok), samt rate limit på
// max 3 mails pr. e-mailadresse pr. døgn og 10 pr. IP pr. time (429).
// Fejler et rate limit-opslag, afviser vi (fail closed) — ellers kunne en
// DB-fejl åbne for ubegrænset udsendelse.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { sendEmail } from '../_shared/send-email.ts'
import { escapeHtml } from '../_shared/notify.ts'

const SITE_URL = 'https://operia-info.predictioninstitute.com'

// Afspejl kun origins vi kender — siden selv + lokal udvikling.
const ALLOWED_ORIGINS = new Set([
  SITE_URL,
  'http://localhost:8788',
  'http://127.0.0.1:8788',
])

function cors(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.has(origin) ? origin : SITE_URL,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

// Klientens IP til rate limit. Supabase-proxyen TILFØJER den faktiske
// klient-IP bagerst i X-Forwarded-For — alt til venstre kan afsenderen selv
// have sat, så det leftmost led må aldrig bruges. Kun syntaktisk gyldige IP'er
// slipper igennem: ip-kolonnen er inet, og en ucastbar værdi ville ellers
// vælte hele insert'en.
function clientIp(req: Request): string | null {
  const last = (req.headers.get('x-forwarded-for') ?? '').split(',').pop()?.trim() ?? ''
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(last) && last.split('.').every((o) => Number(o) <= 255)) {
    return last
  }
  // IPv6: URL-parseren validerer bracket-notationen for os.
  if (last.includes(':') && URL.canParse(`http://[${last}]`)) return last
  return null
}

/* ------------------------------------------------------------------
   Beregningen — SAMME antagelser, formler, felter (min/max/step/def)
   og snap-adfærd som sales-site/index.html. Ret de to steder sammen.
   ------------------------------------------------------------------ */
const A = {
  WORKDAYS: 225,
  WORKWEEKS: 45,
  DAYHOURS: 7.4,
  eff_pkg: 0.75,
  eff_report: 1.0,
  eff_asset: 0.7,
  eff_count: 0.8,
  eff_plan: 0.8,
  red_km: 0.12,
  eff_book: 0.6,
  eff_bookadm: 0.8,
  eff_loss: 0.85,
}

type Field = { id: string; min: number; max: number; step: number; def: number }
type Module = {
  id: string
  name: string
  fields: Field[]
  calc: (v: Record<string, number>) => { hours: number; money: number }
}

const WAGE: Field = { id: 'wage', min: 100, max: 1000, step: 5, def: 300 }

const MODULES: Module[] = [
  {
    id: 'pkg',
    name: 'Pakkehåndtering',
    fields: [
      { id: 'antal', min: 5, max: 300, step: 5, def: 70 },
      { id: 'min', min: 1, max: 10, step: 0.5, def: 2 },
      { id: 'rap', min: 0, max: 40, step: 1, def: 4 },
      { id: 'tab', min: 0, max: 100, step: 1, def: 3 },
      { id: 'vaerdi', min: 100, max: 10000, step: 50, def: 250 },
    ],
    calc: (v) => ({
      hours: (v.antal * v.min / 60) * A.WORKDAYS * A.eff_pkg + v.rap * 12 * A.eff_report,
      money: v.tab * v.vaerdi * A.eff_loss,
    }),
  },
  {
    id: 'asset',
    name: 'Aktivstyring',
    fields: [
      { id: 'soeg', min: 0, max: 40, step: 0.5, def: 4 },
      { id: 'optael', min: 0, max: 300, step: 5, def: 40 },
      { id: 'tab', min: 0, max: 100, step: 1, def: 6 },
      { id: 'vaerdi', min: 500, max: 50000, step: 500, def: 4000 },
    ],
    calc: (v) => ({
      hours: v.soeg * A.WORKWEEKS * A.eff_asset + v.optael * A.eff_count,
      money: v.tab * v.vaerdi * A.eff_loss,
    }),
  },
  {
    id: 'route',
    name: 'Ruteplanlægning',
    fields: [
      { id: 'plan', min: 0, max: 240, step: 5, def: 45 },
      { id: 'km', min: 0, max: 2000, step: 10, def: 120 },
      { id: 'kmpris', min: 1, max: 15, step: 0.5, def: 3.5 },
    ],
    calc: (v) => ({
      hours: (v.plan / 60) * A.WORKDAYS * A.eff_plan,
      money: v.km * A.WORKDAYS * A.red_km * v.kmpris,
    }),
  },
  {
    id: 'book',
    name: 'Booking',
    fields: [
      { id: 'ansatte', min: 5, max: 2000, step: 5, def: 60 },
      { id: 'spild', min: 0, max: 60, step: 1, def: 6 },
      { id: 'adm', min: 0, max: 60, step: 1, def: 3 },
    ],
    calc: (v) => ({
      hours: (v.ansatte * v.spild / 60) * A.WORKWEEKS * A.eff_book + v.adm * 12 * A.eff_bookadm,
      money: 0,
    }),
  },
]

// Snap til nærmeste step og klem inden for min/max — samme regnestykke som
// setValue() i index.html, så mailens tal er identiske med hvad det delte
// link viser, når det åbnes igen.
function clamp(n: unknown, f: Field): number {
  const x = typeof n === 'number' && isFinite(n) ? n : f.def
  const snapped = f.min + Math.round((x - f.min) / f.step) * f.step
  return Math.min(f.max, Math.max(f.min, +snapped.toFixed(4)))
}

const fmt = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 0 })

Deno.serve(async (req) => {
  const CORS = cors(req.headers.get('origin'))
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !serviceKey) {
      console.error('sales-lead: missing SUPABASE_URL / SERVICE_ROLE_KEY')
      return json({ error: 'server_error' }, 500)
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

    // Honeypot udfyldt ⇒ en bot. Svar "ok" uden at gøre noget.
    if (typeof body.website === 'string' && body.website.trim() !== '') return json({ ok: true })

    const email = String(body.email ?? '').trim().toLowerCase().slice(0, 254)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'invalid_email' }, 400)

    const name = String(body.name ?? '').trim().slice(0, 120)
    const company = String(body.company ?? '').trim().slice(0, 120)
    const wantDemo = body.wantDemo === true
    const theme = body.theme === 'operia' ? 'operia' : 'blue'
    const wage = clamp(Number(body.wage), WAGE)

    // Klem modulernes felter og genberegn server-side.
    const rawModules = (body.modules ?? {}) as Record<string, Record<string, unknown>>
    const params: Record<string, Record<string, number | boolean>> = {}
    const perModule: { name: string; kr: number }[] = []
    let totalHours = 0
    let totalMoney = 0
    let total = 0

    for (const m of MODULES) {
      const raw = rawModules[m.id] ?? {}
      const v: Record<string, number> = {}
      for (const f of m.fields) v[f.id] = clamp(Number(raw[f.id]), f)
      const on = raw.on === true
      params[m.id] = { on, ...v }
      if (!on) continue
      const r = m.calc(v)
      const kr = Math.round(r.hours * wage + r.money)
      perModule.push({ name: m.name, kr })
      totalHours += r.hours
      totalMoney += r.money
      total += kr
    }
    if (perModule.length === 0) return json({ error: 'no_modules' }, 400)

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

    // Rate limit: 3 pr. e-mail pr. døgn, 10 pr. IP pr. time. Fejler et opslag,
    // afviser vi hele forespørgslen — et "fail open" her ville lade en DB-fejl
    // åbne for ubegrænset udsendelse.
    const ip = clientIp(req)
    const dayAgo = new Date(Date.now() - 24 * 3600e3).toISOString()
    const hourAgo = new Date(Date.now() - 3600e3).toISOString()
    const { count: byEmail, error: byEmailErr } = await admin
      .from('sales_leads')
      .select('id', { count: 'exact', head: true })
      .eq('email', email)
      .gte('created_at', dayAgo)
    if (byEmailErr) {
      console.error('sales-lead: rate-limit lookup (email) failed', byEmailErr.message)
      return json({ error: 'server_error' }, 500)
    }
    if ((byEmail ?? 0) >= 3) return json({ error: 'rate_limited' }, 429)
    if (ip) {
      const { count: byIp, error: byIpErr } = await admin
        .from('sales_leads')
        .select('id', { count: 'exact', head: true })
        .eq('ip', ip)
        .gte('created_at', hourAgo)
      if (byIpErr) {
        console.error('sales-lead: rate-limit lookup (ip) failed', byIpErr.message)
        return json({ error: 'server_error' }, 500)
      }
      if ((byIp ?? 0) >= 10) return json({ error: 'rate_limited' }, 429)
    }

    // Delbart link med besøgerens tal — genopbygget fra de KLEMTE værdier.
    const shareParts = [`t=${theme}`, `w=${wage}`]
    for (const m of MODULES) {
      const p = params[m.id]
      const vals = m.fields.map((f) => p[f.id])
      shareParts.push(`${m.id}=${p.on ? 1 : 0}_${vals.join('_')}`)
    }
    const shareUrl = `${SITE_URL}/?${shareParts.join('&')}`

    // Gem leadet FØR mailen sendes — et demo-ønske må ikke gå tabt, og fejler
    // insert'en, skal afsenderen have en fejl i stedet for et tavst "ok".
    const { data: lead, error: insErr } = await admin
      .from('sales_leads')
      .insert({
        email,
        name: name || null,
        company: company || null,
        want_demo: wantDemo,
        theme,
        params: { wage, modules: params, total },
        total_kr: total,
        email_sent: false,
        ip,
        user_agent: (req.headers.get('user-agent') ?? '').slice(0, 300) || null,
      })
      .select('id')
      .single()
    if (insErr) {
      console.error('sales-lead: insert failed', insErr.message)
      return json({ error: 'server_error' }, 500)
    }

    // E-mailen: enkel, lys og mail-klient-sikker (inline styles, tabelløst).
    const accent = theme === 'operia' ? '#1d7a40' : '#2D6FF0'
    const hours = Math.round(totalHours)
    const days = Math.round(totalHours / A.DAYHOURS)
    const money = Math.round(totalMoney)
    const rows = perModule
      .map((r) =>
        `<tr><td style="padding:8px 0;color:#5b6b80;border-bottom:1px solid #e3e8ef;">${escapeHtml(r.name)}</td>` +
        `<td style="padding:8px 0;text-align:right;font-weight:600;border-bottom:1px solid #e3e8ef;">${fmt.format(r.kr)} kr./år</td></tr>`
      )
      .join('')
    const hello = name ? `Hej ${escapeHtml(name)}` : 'Hej'
    const html =
      `<div style="font-family:Inter,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0b1220;font-size:15px;line-height:1.55;">` +
      `<p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:${accent};font-weight:600;margin:24px 0 4px;">Operia &middot; Besparelsesberegner</p>` +
      `<h1 style="font-size:22px;margin:0 0 16px;">Jeres beregning</h1>` +
      `<p>${hello},</p>` +
      `<p>her er den beregning, du lavede på Operias besparelsesberegner${company ? ` for ${escapeHtml(company)}` : ''}:</p>` +
      `<table style="width:100%;border-collapse:collapse;margin:18px 0;font-size:15px;">${rows}` +
      `<tr><td style="padding:12px 0;font-weight:700;">Samlet besparelse pr. år</td>` +
      `<td style="padding:12px 0;text-align:right;font-weight:800;font-size:19px;color:${accent};">${fmt.format(total)} kr.</td></tr></table>` +
      `<p style="margin:0 0 6px;">Det dækker over <strong>${fmt.format(hours)} sparede timer</strong> om året (svarende til ca. ${fmt.format(days)} arbejdsdage)` +
      (money > 0 ? ` og <strong>${fmt.format(money)} kr.</strong> i undgåede direkte omkostninger` : '') +
      `.</p>` +
      `<p><a href="${shareUrl}" style="color:${accent};">Åbn beregningen igen med jeres tal</a> — linket kan deles med kolleger.</p>` +
      (wantDemo
        ? `<p>Du har bedt om at høre mere om en demo af Operia — vi kontakter dig snarest. Du er også velkommen til blot at besvare denne mail.</p>`
        : `<p>Vil du se Operia i praksis? Besvar denne mail, så finder vi et tidspunkt til en demo.</p>`) +
      `<p style="font-size:12px;color:#5b6b80;margin-top:24px;border-top:1px solid #e3e8ef;padding-top:12px;">` +
      `Beregnet ud fra ${A.WORKDAYS} effektive arbejdsdage (${A.WORKWEEKS} arbejdsuger) og en 7,4-timers arbejdsdag. ` +
      `Estimatet bygger på erfaringstal og er ikke et tilbud. Venlig hilsen DCA Logic.</p></div>`

    const sent = await sendEmail(email, `Jeres besparelse med Operia: ${fmt.format(total)} kr. pr. år`, html)

    const { error: updErr } = await admin
      .from('sales_leads')
      .update({ email_sent: sent.ok, email_error: sent.ok ? null : sent.error ?? 'unknown' })
      .eq('id', lead.id)
    if (updErr) console.error('sales-lead: status update failed', updErr.message)

    // Intern notifikation (valgfri): sæt LEAD_NOTIFY_EMAIL som edge-secret.
    const notifyTo = Deno.env.get('LEAD_NOTIFY_EMAIL')
    if (notifyTo) {
      const nHtml =
        `<div style="font-family:Inter,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0b1220;font-size:14px;line-height:1.55;">` +
        `<h2 style="font-size:17px;">${wantDemo ? '🔥 Demo-ønske' : 'Nyt lead'} fra besparelsesberegneren</h2>` +
        `<p><strong>E-mail:</strong> ${escapeHtml(email)}<br>` +
        (name ? `<strong>Navn:</strong> ${escapeHtml(name)}<br>` : '') +
        (company ? `<strong>Virksomhed:</strong> ${escapeHtml(company)}<br>` : '') +
        `<strong>Demo ønsket:</strong> ${wantDemo ? 'JA' : 'nej'}<br>` +
        `<strong>Beregnet besparelse:</strong> ${fmt.format(total)} kr./år (${perModule.map((r) => escapeHtml(r.name)).join(', ')})</p>` +
        `<p><a href="${shareUrl}">Åbn beregningen med kundens tal</a></p>` +
        (sent.ok ? '' : `<p style="color:#ad423f;">OBS: mailen til kunden fejlede (${escapeHtml(sent.error ?? '')}).</p>`) +
        `</div>`
      await sendEmail(
        notifyTo,
        `${wantDemo ? 'Demo-ønske' : 'Lead'}: ${company || name || email} — ${fmt.format(total)} kr./år`,
        nHtml,
      )
    }

    if (!sent.ok) {
      console.error('sales-lead: email failed', sent.error)
      return json({ error: 'email_failed' }, 502)
    }
    return json({ ok: true })
  } catch (e) {
    console.error('sales-lead: unhandled', String(e).slice(0, 300))
    return json({ error: 'server_error' }, 500)
  }
})
